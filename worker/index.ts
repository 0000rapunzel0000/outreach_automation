// Long-running worker (§1): Baileys client, pg-boss handlers, reconciler + retention crons.
// Must not run on serverless. Exactly one instance (enforced with a Postgres advisory lock).
import pg from "pg";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { log } from "@/lib/logger";
import { getSetting, getState, clearState, setState } from "@/lib/settings";
import { getBoss, JOBS, stopBoss } from "@/lib/queue";
import { audit } from "@/lib/audit";
import { unipile } from "@/lib/unipile";
import { deliverNotification, setWhatsAppProvider } from "@/lib/notify";
import { reconcile } from "@/lib/monitoring/reconciler";
import { deleteUnipileAccountJob, nudgeJob, promoteErrorJob } from "@/lib/monitoring/jobs";
import { runRetention } from "@/lib/retention";
import { BaileysProvider } from "./baileys/provider";

const LOCK_KEY = 72_410_001; // arbitrary, app-wide

async function acquireSingletonLock() {
  const client = new pg.Client({ connectionString: env().DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY]);
  if (!rows[0]?.ok) {
    log.error("another worker holds the lock; exiting (only one worker may run Baileys)");
    process.exit(1);
  }
  return client; // keep the session open for the life of the process
}

async function main() {
  env(); // fail fast on bad config
  const lock = await acquireSingletonLock();
  const boss = await getBoss("worker");

  let wa: BaileysProvider | null = null;
  if (env().WA_DISABLED) {
    log.info("WA_DISABLED=true: WhatsApp messages will be logged, not sent");
    await setState("wa.status", { status: "disabled", at: now().toISOString() });
  } else {
    wa = new BaileysProvider();
    setWhatsAppProvider(wa);
    await wa.start();
  }

  try {
    await unipile().ensureAccountStatusWebhook();
  } catch (e) {
    log.error("ensureAccountStatusWebhook failed (will retry next boot)", { err: e });
  }

  const run = <T>(fn: (data: T) => Promise<unknown>) => async (jobs: { data: T }[]) => {
    for (const j of jobs) await fn(j.data);
  };
  await boss.work(JOBS.deliverNotification, { batchSize: 1, pollingIntervalSeconds: 2 }, run(deliverNotification));
  await boss.work(JOBS.promoteError, { batchSize: 1, pollingIntervalSeconds: 5 }, run(promoteErrorJob));
  await boss.work(JOBS.nudge, { batchSize: 1, pollingIntervalSeconds: 5 }, run(nudgeJob));
  await boss.work(JOBS.deleteUnipileAccount, { batchSize: 1, pollingIntervalSeconds: 30 }, run(deleteUnipileAccountJob));
  await boss.work(JOBS.reconcile, { batchSize: 1, pollingIntervalSeconds: 10 }, run(async () => log.info("reconcile", await reconcile())));
  await boss.work(JOBS.retention, { batchSize: 1, pollingIntervalSeconds: 60 }, run(runRetention));

  const interval = await getSetting("reconciler.intervalMin");
  const cron = interval < 60 ? `*/${interval} * * * *` : `0 */${Math.min(Math.floor(interval / 60), 23)} * * *`;
  await boss.schedule(JOBS.reconcile, cron, {}, { tz: "Asia/Kolkata" });
  await boss.schedule(JOBS.retention, "0 3 * * *", {}, { tz: "Asia/Kolkata" });
  await boss.send(JOBS.reconcile, {}); // once at boot
  log.info("worker started", { reconcileCron: cron });

  // Heartbeat (also written by every reconcile run).
  const beat = () => setState("worker.heartbeat", now().toISOString()).catch((e) => log.error("heartbeat failed", { err: e }));
  await beat();
  const heartbeat = setInterval(beat, 5 * 60_000);

  // Web -> worker RPC rows, polled every second.
  const rpc = setInterval(async () => {
    const cmds = await db.workerCommand.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 10 }).catch(() => []);
    for (const c of cmds) {
      try {
        let result: object = {};
        if (c.kind === "wa.onWhatsApp") {
          if (!wa) throw new Error("WhatsApp is disabled");
          if (!(await wa.isHealthy())) throw new Error("WhatsApp sender is not connected. Please try again later.");
          result = { exists: await wa.onWhatsApp((c.payload as { phone: string }).phone) };
        } else throw new Error(`unknown command ${c.kind}`);
        await db.workerCommand.update({ where: { id: c.id }, data: { status: "done", result, doneAt: now() } });
      } catch (e) {
        await db.workerCommand.update({ where: { id: c.id }, data: { status: "error", result: { message: e instanceof Error ? e.message : String(e) }, doneAt: now() } });
      }
    }
  }, 1_000);

  // Admin WhatsApp controls go through Setting['wa.command'] (§5.1), polled every 5 s.
  const commands = setInterval(async () => {
    try {
      const cmd = await getState<{ cmd: "relink" | "logout"; pairingPhone?: string; actorId?: string }>("wa.command");
      if (!cmd) return;
      await clearState("wa.command");
      if (!wa) return;
      log.info("wa command", { cmd: cmd.cmd });
      if (cmd.cmd === "relink") await wa.relink(cmd.pairingPhone);
      if (cmd.cmd === "logout") await wa.logout();
      await audit({ actorId: cmd.actorId ?? null, action: cmd.cmd === "relink" ? "wa.relink" : "wa.logout", targetType: "whatsapp" });
    } catch (e) {
      log.error("wa command failed", { err: e });
    }
  }, 5_000);

  const shutdown = async (sig: string) => {
    log.info("worker shutting down", { sig });
    clearInterval(heartbeat);
    clearInterval(rpc);
    clearInterval(commands);
    await wa?.stop();
    await stopBoss();
    await lock.end();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  log.error("worker crashed", { err: e });
  process.exit(1);
});
