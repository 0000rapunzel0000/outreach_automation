import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { DAY, now } from "@/lib/clock";
import { log } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { getAllSettings, getSetting } from "@/lib/settings";
import { JOBS, queue } from "@/lib/queue";
import { notify } from "@/lib/notify";
import { unipile } from "@/lib/unipile";
import { applyStatus, incidentJobPrefix, rungDueAt, scheduleRung } from "@/lib/monitoring/applyStatus";
import { mintReconnectLink } from "@/lib/monitoring/tokens";
import { onEmployeeActivated, onEmployeeOffboarded } from "@/lib/payroll/hooks";

export class LifecycleError extends Error {}

async function load(personId: string) {
  const p = await db.person.findUnique({ where: { id: personId }, include: { linkedin: true, user: true } });
  if (!p) throw new LifecycleError("Person not found");
  return p;
}

/** Re-run the state machine with the account's current status (approve / reactivate). */
async function recheckLink(personId: string) {
  const p = await load(personId);
  if (p.linkedin?.lastRawStatus) await applyStatus(p.linkedin.id, p.linkedin.lastRawStatus, "manual");
}

/** Remove the Unipile account now; if that fails, a job keeps retrying. */
async function removeUnipileAccount(unipileAccountId: string) {
  try {
    await unipile().deleteAccount(unipileAccountId);
  } catch (e) {
    log.warn("deleteAccount failed; queued for retry", { unipileAccountId, err: e });
    await queue().send(JOBS.deleteUnipileAccount, { unipileAccountId });
  }
}

async function closeOpenIncident(personId: string, reason: string, actorId: string | null) {
  const open = await db.incident.findFirst({ where: { personId, resolvedAt: null } });
  if (!open) return;
  await db.incident.update({ where: { id: open.id }, data: { resolvedAt: now() } });
  await queue().cancelByPrefix(incidentJobPrefix(open.id));
  await audit({ actorId, action: "incident.resolve", targetType: "person", targetId: personId, metadata: { incidentId: open.id, reason } });
}

export async function approve(personId: string, actorId: string) {
  const p = await load(personId);
  if (p.status !== "PENDING_REVIEW") throw new LifecycleError("Only pending applications can be approved");
  const activatedAt = now();
  await db.$transaction(async (tx) => {
    await tx.person.update({
      where: { id: personId },
      data: { status: "ACTIVE", activatedAt, reviewedById: actorId, reviewedAt: activatedAt },
    });
    await tx.user.update({ where: { id: p.userId }, data: { role: "EMPLOYEE" } });
    await audit({ actorId, action: "person.approve", targetType: "person", targetId: personId }, tx);
  });
  await onEmployeeActivated(personId, activatedAt);
  await notify(personId, "approved", { portalLink: `${env().APP_BASE_URL}/portal` });
  await recheckLink(personId); // already disconnected -> incident starts now
}

export async function reject(personId: string, actorId: string, reason: string) {
  if (!reason.trim()) throw new LifecycleError("A rejection reason is required");
  const p = await load(personId);
  if (p.status !== "PENDING_REVIEW") throw new LifecycleError("Only pending applications can be rejected");
  const days = await getSetting("retention.rejectedDays");
  const t = now();
  await db.$transaction(async (tx) => {
    await tx.person.update({
      where: { id: personId },
      data: { status: "REJECTED", rejectionReason: reason.trim(), reviewedById: actorId, reviewedAt: t, purgeAfter: new Date(t.getTime() + days * DAY) },
    });
    if (p.linkedin) await tx.linkedInAccount.update({ where: { id: p.linkedin.id }, data: { status: "DELETED" } });
    await audit({ actorId, action: "person.reject", targetType: "person", targetId: personId, metadata: { reason: reason.trim() } }, tx);
  });
  if (p.linkedin) await removeUnipileAccount(p.linkedin.unipileAccountId);
  await notify(personId, "rejected");
}

export async function suspend(personId: string, actorId: string) {
  const p = await load(personId);
  if (p.status !== "ACTIVE") throw new LifecycleError("Only active employees can be suspended");
  await db.person.update({ where: { id: personId }, data: { status: "SUSPENDED", suspendedAt: now() } });
  // Keep the incident (uptime evidence) but stop its nudges.
  const open = await db.incident.findFirst({ where: { personId, resolvedAt: null } });
  if (open) await queue().cancelByPrefix(incidentJobPrefix(open.id));
  await audit({ actorId, action: "person.suspend", targetType: "person", targetId: personId });
}

export async function reactivate(personId: string, actorId: string) {
  const p = await load(personId);
  if (p.status !== "SUSPENDED") throw new LifecycleError("Only suspended employees can be reactivated");
  await db.person.update({ where: { id: personId }, data: { status: "ACTIVE", suspendedAt: null } });
  await audit({ actorId, action: "person.reactivate", targetType: "person", targetId: personId });
  await recheckLink(personId);
  // An incident that was open through the suspension resumes its ladder where it stopped.
  const open = await db.incident.findFirst({ where: { personId, resolvedAt: null } });
  const acct = (await load(personId)).linkedin;
  if (open && acct && acct.status === "NEEDS_RECONNECT" && open.nudgeCount > 0) {
    const s = await getAllSettings();
    const rung = open.nudgeCount + 1;
    if (open.nudgeCount < s["nudge.maxNudges"]) await scheduleRung(open.id, rung, rungDueAt(open, rung, s));
  }
}

export async function offboard(personId: string, actorId: string) {
  const p = await load(personId);
  if (!["ACTIVE", "SUSPENDED"].includes(p.status)) throw new LifecycleError("Only active or suspended employees can be offboarded");
  const t = now();
  await db.person.update({ where: { id: personId }, data: { status: "OFFBOARDED", offboardedAt: t } });
  await closeOpenIncident(personId, "offboarded", actorId);
  if (p.linkedin) {
    await db.linkedInAccount.update({ where: { id: p.linkedin.id }, data: { status: "DELETED" } });
    await removeUnipileAccount(p.linkedin.unipileAccountId);
  }
  await onEmployeeOffboarded(personId, t);
  await audit({ actorId, action: "person.offboard", targetType: "person", targetId: personId });
}

/** Admin "send nudge now": outside the ladder, ignores quiet hours (an admin chose to send it). */
export async function manualNudge(personId: string, actorId: string) {
  const p = await load(personId);
  if (!p.linkedin || p.linkedin.status === "CONNECTED") throw new LifecycleError("LinkedIn is connected; nothing to nudge");
  const open = await db.incident.findFirst({ where: { personId, resolvedAt: null } });
  const link = await mintReconnectLink(personId, open?.id);
  await notify(personId, "nudge_2", { link }, { incidentId: open?.id, bypassQuietHours: true });
  await audit({ actorId, action: "nudge.manual", targetType: "person", targetId: personId, metadata: { incidentId: open?.id ?? null } });
}
