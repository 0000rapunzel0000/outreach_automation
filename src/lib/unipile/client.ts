import { z } from "zod";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { now } from "@/lib/clock";
import { linkedinProfileUrl, notifyUrl, redirectUrls, webhookUrl } from "./urls";
import { UnipileError, type HostedAuthOpts, type UnipileAccount, type UnipileClient } from "./types";

// Wire shapes as documented at developer.unipile.com. Verify on changes; extra fields are allowed.
const wireAccount = z
  .object({
    id: z.string(),
    type: z.string(),
    name: z.string().nullish(),
    sources: z.array(z.object({ id: z.string().optional(), status: z.string() }).passthrough()).nullish(),
    connection_params: z
      .object({
        im: z
          .object({
            id: z.string().nullish(),
            publicIdentifier: z.string().nullish(),
            username: z.string().nullish(),
          })
          .passthrough()
          .nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

type WireAccount = z.infer<typeof wireAccount>;

/** The ONE place that knows where an account's status lives. */
export function extractRawStatus(a: WireAccount): string {
  const statuses = (a.sources ?? []).map((s) => s.status);
  if (!statuses.length) return "UNKNOWN";
  // Worst status wins if an account has several sources.
  const bad = statuses.find((s) => !["OK", "CREATION_SUCCESS", "RECONNECTED", "SYNC_SUCCESS"].includes(s));
  return bad ?? statuses[0];
}

function toAccount(a: WireAccount): UnipileAccount {
  const im = a.connection_params?.im;
  const publicIdentifier = im?.publicIdentifier ?? null;
  return {
    id: a.id,
    type: a.type,
    displayName: a.name ?? im?.username ?? null,
    rawStatus: extractRawStatus(a),
    providerUserId: im?.id ?? null,
    publicIdentifier,
    profileUrl: linkedinProfileUrl(publicIdentifier),
  };
}

/**
 * POST /hosted/accounts/link body, per developer.unipile.com (checked 2026-10-26).
 * The "Reconnection link" schema has no `providers` (create-only), so it's left out there.
 * Links also expire at Unipile's daily restart, which is why /r/<token> mints a fresh one per click.
 */
export function hostedAuthBody(opts: HostedAuthOpts): Record<string, unknown> {
  if (opts.type === "reconnect" && !opts.reconnectAccountId) throw new Error("reconnectAccountId required");
  const r = redirectUrls(opts.type);
  const body: Record<string, unknown> = {
    type: opts.type,
    api_url: `https://${env().UNIPILE_DSN}`,
    expiresOn: new Date(now().getTime() + (opts.expiresInMin ?? 60) * 60_000).toISOString(),
    notify_url: notifyUrl(),
    name: opts.personId,
    success_redirect_url: r.success,
    failure_redirect_url: r.failure,
  };
  if (opts.type === "create") body.providers = ["LINKEDIN"];
  else body.reconnect_account = opts.reconnectAccountId;
  return body;
}

const TIMEOUT_MS = 15_000;
const RETRIES = 3;

export class HttpUnipileClient implements UnipileClient {
  private get base() {
    return `https://${env().UNIPILE_DSN}/api/v1`;
  }

  private async call<T>(method: string, path: string, body?: unknown, opts: { allow404?: boolean } = {}): Promise<T | null> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1) + Math.random() * 250));
      const started = Date.now();
      try {
        const res = await fetch(`${this.base}${path}`, {
          method,
          headers: { "X-API-KEY": env().UNIPILE_API_KEY, accept: "application/json", "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        log.debug("unipile call", { method, path: path.split("?")[0], status: res.status, ms: Date.now() - started });
        if (res.status === 404 && opts.allow404) return null;
        if (res.status >= 500) {
          lastErr = new UnipileError(`Unipile ${method} ${path} -> ${res.status}`, res.status);
          continue;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new UnipileError(`Unipile ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`, res.status);
        }
        if (res.status === 204) return null;
        return (await res.json()) as T;
      } catch (e) {
        if (e instanceof UnipileError && e.status && e.status < 500) throw e;
        lastErr = e;
        log.warn("unipile call failed, retrying", { method, path: path.split("?")[0], attempt, err: e });
      }
    }
    throw lastErr instanceof Error ? lastErr : new UnipileError(String(lastErr));
  }

  async createHostedAuthLink(opts: HostedAuthOpts) {
    const res = await this.call<{ url: string }>("POST", "/hosted/accounts/link", hostedAuthBody(opts));
    if (!res?.url) throw new UnipileError("Unipile returned no hosted auth url");
    return { url: res.url };
  }

  async getAccount(accountId: string) {
    const raw = await this.call<unknown>("GET", `/accounts/${encodeURIComponent(accountId)}`, undefined, { allow404: true });
    if (!raw) return null;
    return toAccount(wireAccount.parse(raw));
  }

  async listAccounts() {
    const out: UnipileAccount[] = [];
    let cursor: string | null | undefined;
    do {
      const qs = new URLSearchParams({ limit: "250" });
      if (cursor) qs.set("cursor", cursor);
      const page = await this.call<{ items: unknown[]; cursor?: string | null }>("GET", `/accounts?${qs}`);
      for (const item of page?.items ?? []) {
        const parsed = wireAccount.safeParse(item);
        if (parsed.success) out.push(toAccount(parsed.data));
        else log.warn("unipile account did not parse", { issues: parsed.error.issues.slice(0, 3) });
      }
      cursor = page?.cursor;
    } while (cursor);
    return out;
  }

  async deleteAccount(accountId: string) {
    await this.call("DELETE", `/accounts/${encodeURIComponent(accountId)}`, undefined, { allow404: true });
  }

  async ensureAccountStatusWebhook() {
    const url = webhookUrl();
    const list = await this.call<{ items?: { source?: string; request_url?: string }[] }>("GET", "/webhooks");
    if (list?.items?.some((w) => w.source === "account_status" && w.request_url === url)) return;
    await this.call("POST", "/webhooks", {
      source: "account_status",
      request_url: url,
      name: "account-status",
      headers: [{ key: "x-webhook-secret", value: env().UNIPILE_WEBHOOK_SECRET }],
    });
    log.info("created unipile account_status webhook", { url });
  }
}
