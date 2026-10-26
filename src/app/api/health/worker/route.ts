import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { HOUR, MIN, now } from "@/lib/clock";
import { log } from "@/lib/logger";
import { getState, setState } from "@/lib/settings";
import { sendEmailNow } from "@/lib/notify";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Heartbeat watchdog (§7). Point an uptime pinger (or a cron) at this every few minutes.
 * 503 when the worker heartbeat is older than 30 min; emails admins at most once an hour.
 */
export async function GET() {
  const beat = await getState<string>("worker.heartbeat");
  const age = beat ? now().getTime() - new Date(beat).getTime() : Infinity;
  const healthy = age < 30 * MIN;
  const wa = await getState<{ status: string }>("wa.status");

  if (!healthy) {
    const lastAlert = await getState<string>("watchdog.lastAlertAt");
    if (!lastAlert || now().getTime() - new Date(lastAlert).getTime() > HOUR) {
      await setState("watchdog.lastAlertAt", now().toISOString());
      const admins = await db.user.findMany({ where: { role: "SUPER_ADMIN" }, select: { email: true } });
      const to = new Set([...env().ADMIN_ALERT_EMAILS, ...admins.map((a) => a.email)]);
      for (const addr of to) {
        await sendEmailNow(addr, "admin_worker_silent").catch((e) => log.error("watchdog email failed", { err: e }));
      }
    }
  }
  return NextResponse.json(
    { ok: healthy, heartbeat: beat, ageSeconds: Number.isFinite(age) ? Math.round(age / 1000) : null, whatsapp: wa?.status ?? "unknown" },
    { status: healthy ? 200 : 503 },
  );
}
