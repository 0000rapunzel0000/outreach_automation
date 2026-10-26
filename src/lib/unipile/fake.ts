import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { randomToken } from "@/lib/crypto";
import { linkedinProfileUrl, notifyUrl, redirectUrls } from "./urls";
import type { HostedAuthOpts, UnipileAccount, UnipileClient } from "./types";

// UNIPILE_FAKE=true (§12). Accounts live in FakeUnipileAccount so web and worker share them.

type Row = { id: string; name: string; providerUserId: string; publicId: string; status: string };

function toAccount(r: Row): UnipileAccount {
  return {
    id: r.id,
    type: "LINKEDIN",
    displayName: r.name,
    rawStatus: r.status,
    providerUserId: r.providerUserId,
    publicIdentifier: r.publicId,
    profileUrl: linkedinProfileUrl(r.publicId),
  };
}

export class FakeUnipileClient implements UnipileClient {
  async createHostedAuthLink(opts: HostedAuthOpts) {
    const r = redirectUrls(opts.type);
    const qs = new URLSearchParams({
      type: opts.type,
      name: opts.personId,
      success: r.success,
      failure: r.failure,
    });
    if (opts.reconnectAccountId) qs.set("account", opts.reconnectAccountId);
    return { url: `${env().APP_BASE_URL}/dev/fake-unipile?${qs}` };
  }

  async getAccount(accountId: string) {
    const r = await db.fakeUnipileAccount.findUnique({ where: { id: accountId } });
    return r ? toAccount(r) : null;
  }

  async listAccounts() {
    if (await db.setting.findUnique({ where: { key: "fake.unipileDown" } })) throw new Error("fake Unipile is down");
    return (await db.fakeUnipileAccount.findMany({ orderBy: { createdAt: "asc" } })).map(toAccount);
  }

  async deleteAccount(accountId: string) {
    await db.fakeUnipileAccount.deleteMany({ where: { id: accountId } });
  }

  async ensureAccountStatusWebhook() {}
}

/** What the fake hosted-auth page's "Succeed" button does: make/refresh an account and call notify_url like Unipile. */
export async function fakeHostedAuthSucceed(p: { type: "create" | "reconnect"; name: string; account?: string; linkedinId: string; displayName: string }) {
  let accountId = p.account;
  if (p.type === "create" || !accountId) {
    accountId = `fake_${randomToken(9)}`;
    await db.fakeUnipileAccount.create({
      data: { id: accountId, name: p.displayName, providerUserId: p.linkedinId, publicId: p.linkedinId, status: "OK" },
    });
  } else {
    await db.fakeUnipileAccount.update({ where: { id: accountId }, data: { status: "OK" } });
  }
  const res = await fetch(notifyUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: p.type === "create" ? "CREATION_SUCCESS" : "RECONNECTED", account_id: accountId, name: p.name }),
  });
  return { accountId, notifyStatus: res.status };
}

/** Dev console: set a fake account's status and fire the real webhook endpoint with the right secret. */
export async function fakeFireStatus(accountId: string, status: string) {
  if (status === "DELETED") await db.fakeUnipileAccount.deleteMany({ where: { id: accountId } });
  else await db.fakeUnipileAccount.update({ where: { id: accountId }, data: { status } });
  const res = await fetch(`${env().APP_BASE_URL}/api/webhooks/unipile`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-secret": env().UNIPILE_WEBHOOK_SECRET },
    body: JSON.stringify({ AccountStatus: { account_id: accountId, account_type: "LINKEDIN", message: status } }),
  });
  return res.status;
}
