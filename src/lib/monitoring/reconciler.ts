import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { log } from "@/lib/logger";
import { setState } from "@/lib/settings";
import { unipile, type UnipileAccount } from "@/lib/unipile";
import { applyStatus } from "./applyStatus";

/**
 * Safety net for missed webhooks (§7). A failed listAccounts() aborts the run:
 * it must never mark accounts DELETED.
 */
export async function reconcile() {
  await setState("worker.heartbeat", now().toISOString());

  let remote: UnipileAccount[];
  try {
    remote = await unipile().listAccounts();
  } catch (e) {
    log.error("reconciler: listAccounts failed; skipping this run", { err: e });
    await setState("reconciler.lastError", { at: now().toISOString(), message: e instanceof Error ? e.message : String(e) });
    return { checked: 0, changed: 0, orphans: null as number | null, skipped: true };
  }

  const byId = new Map(remote.map((a) => [a.id, a]));
  const local = await db.linkedInAccount.findMany({
    where: { person: { status: { in: ["PENDING_REVIEW", "ACTIVE", "SUSPENDED"] } } },
  });

  let changed = 0;
  for (const acct of local) {
    const r = byId.get(acct.unipileAccountId);
    const raw = r ? r.rawStatus : "DELETED";
    if (raw === acct.lastRawStatus) continue;
    try {
      await applyStatus(acct.id, raw, "reconciler", { payload: { reconciled: true } });
      changed++;
    } catch (e) {
      log.error("reconciler: applyStatus failed", { accountId: acct.id, err: e });
    }
  }

  // Remote LinkedIn accounts we don't know about cost money. Count them; never auto-delete.
  const allLocal = new Set((await db.linkedInAccount.findMany({ select: { unipileAccountId: true } })).map((a) => a.unipileAccountId));
  const orphans = remote.filter((a) => a.type === "LINKEDIN" && !allLocal.has(a.id));
  if (orphans.length) log.warn("reconciler: orphan Unipile accounts", { count: orphans.length, ids: orphans.map((o) => o.id) });
  await setState("unipile.orphans", { count: orphans.length, ids: orphans.map((o) => o.id).slice(0, 100), at: now().toISOString() });
  await setState("reconciler.lastRun", { at: now().toISOString(), checked: local.length, changed });

  return { checked: local.length, changed, orphans: orphans.length, skipped: false };
}
