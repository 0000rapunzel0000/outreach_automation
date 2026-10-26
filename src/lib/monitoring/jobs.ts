import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { fmtIst, now } from "@/lib/clock";
import { log } from "@/lib/logger";
import { getAllSettings } from "@/lib/settings";
import { unipile } from "@/lib/unipile";
import { notify, notifyAdmins } from "@/lib/notify";
import type { TemplateKey } from "@/lib/notify/templates";
import { applyStatus, ESCALATION_RUNG, rungDueAt, scheduleRung } from "./applyStatus";
import { mintReconnectLink } from "./tokens";
import { normalize } from "./normalize";

/** promote-error: an ERROR that outlived its grace period becomes NEEDS_RECONNECT, unless it healed. */
export async function promoteErrorJob({ incidentId }: { incidentId: string }) {
  const inc = await db.incident.findUnique({ where: { id: incidentId }, include: { person: { include: { linkedin: true } } } });
  const acct = inc?.person.linkedin;
  if (!inc || inc.resolvedAt || !acct || acct.status !== "TRANSIENT_ERROR") return;

  const live = await unipile().getAccount(acct.unipileAccountId); // throws -> pg-boss retries
  if (!live) return applyStatus(acct.id, "DELETED", "reconciler");
  // Still ERROR, or any unknown status that also normalises to TRANSIENT_ERROR: past grace, so promote.
  if (normalize(live.rawStatus) === "TRANSIENT_ERROR") return applyStatus(acct.id, live.rawStatus, "reconciler", { promote: true });
  return applyStatus(acct.id, live.rawStatus, "manual");
}

const RUNG_TEMPLATE = (rung: number): TemplateKey =>
  rung === 1 ? "nudge_1" : rung === 2 ? "nudge_2" : rung === ESCALATION_RUNG ? "nudge_final" : "nudge_daily";

/** nudge: send one rung of the ladder, then schedule the next (§6). */
export async function nudgeJob({ incidentId, rung }: { incidentId: string; rung: number }) {
  const s = await getAllSettings();
  const inc = await db.incident.findUnique({ where: { id: incidentId }, include: { person: { include: { linkedin: true } } } });
  if (!inc || inc.resolvedAt) return;
  const person = inc.person;
  if (person.status !== "ACTIVE" || !person.linkedin || person.linkedin.status === "CONNECTED") return;
  if (inc.nudgeCount >= s["nudge.maxNudges"]) return;
  if (rung > ESCALATION_RUNG && !s["nudge.dailyReminderAfterEscalation"]) return;

  const link = await mintReconnectLink(person.id, inc.id);
  await notify(person.id, RUNG_TEMPLATE(rung), { link }, { incidentId: inc.id });

  const t = now();
  const updated = await db.incident.update({
    where: { id: inc.id },
    data: { nudgeCount: { increment: 1 }, lastNudgeAt: t, ...(rung === ESCALATION_RUNG ? { escalatedAt: t } : {}) },
  });

  if (rung === ESCALATION_RUNG) {
    await notifyAdmins(
      "admin_escalation",
      {
        fullName: person.fullName ?? "Unknown",
        phone: person.whatsappE164 ?? person.mobileE164 ?? "—",
        since: fmtIst(inc.startedAt),
        adminLink: `${env().APP_BASE_URL}/admin/people/${person.id}`,
      },
      { incidentId: inc.id },
    );
  }

  const nextRung = rung + 1;
  if (updated.nudgeCount >= s["nudge.maxNudges"]) return;
  if (nextRung > ESCALATION_RUNG && !s["nudge.dailyReminderAfterEscalation"]) return;
  await scheduleRung(inc.id, nextRung, rungDueAt(updated, nextRung, s));
}

/** Reject/offboard: remove the Unipile account (we pay per account). Retried by pg-boss on failure. */
export async function deleteUnipileAccountJob({ unipileAccountId }: { unipileAccountId: string }) {
  await unipile().deleteAccount(unipileAccountId);
  log.info("deleted unipile account", { unipileAccountId });
}
