import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { safeEqual } from "@/lib/crypto";
import { rateLimit } from "@/lib/ratelimit";
import { applyStatus } from "@/lib/monitoring/applyStatus";

const body = z
  .object({
    AccountStatus: z
      .object({ account_id: z.string(), account_type: z.string(), message: z.string() })
      .passthrough(),
  })
  .passthrough();

const ok = () => NextResponse.json({ ok: true });

/**
 * Unipile account-status webhook (§4.2). Always 200 once authenticated, so Unipile
 * doesn't retry-storm; the reconciler covers anything we fail to process.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-webhook-secret") ?? "";
  if (!safeEqual(secret, env().UNIPILE_WEBHOOK_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await rateLimit("webhook:unipile", 600, 60))) {
    log.warn("unipile webhook rate limit hit; dropping (reconciler will catch up)");
    return ok();
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return ok();
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    log.warn("unipile webhook: unexpected shape", { issues: parsed.error.issues.slice(0, 3) });
    return ok();
  }
  const { account_id, account_type, message } = parsed.data.AccountStatus;
  if (account_type !== "LINKEDIN") return ok();

  const acct = await db.linkedInAccount.findUnique({ where: { unipileAccountId: account_id } });
  if (!acct) {
    log.info("unipile webhook: unknown account", { account_id });
    return ok();
  }
  try {
    await applyStatus(acct.id, message, "webhook", { payload: parsed.data.AccountStatus as object as never });
  } catch (e) {
    log.error("unipile webhook: applyStatus failed", { account_id, err: e });
  }
  return ok();
}
