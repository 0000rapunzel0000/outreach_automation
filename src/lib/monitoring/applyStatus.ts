import type { Incident, LinkStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { DAY, MIN, now } from "@/lib/clock";
import { log } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { getAllSettings, type NudgeSettings } from "@/lib/settings";
import { JOBS, queue } from "@/lib/queue";
import { notify } from "@/lib/notify";
import { normalize } from "./normalize";

export type StatusSource = "webhook" | "reconciler" | "notify_url" | "manual";

type Effect =
  | { kind: "schedule"; incidentId: string; rung: number; at: Date }
  | { kind: "promote"; incidentId: string; at: Date }
  | { kind: "cancel"; incidentId: string }
  | { kind: "notify"; personId: string; template: "reconnected"; incidentId: string }
  | { kind: "flag"; personId: string; message: string };

export const ESCALATION_RUNG = 3;

export function incidentJobPrefix(incidentId: string) {
  return `incident:${incidentId}:`;
}

/** When a ladder rung is due (§6): rung 1/2/3 relative to the incident start, then daily after escalation. */
export function rungDueAt(inc: Pick<Incident, "startedAt" | "escalatedAt">, rung: number, s: NudgeSettings): Date {
  const start = inc.startedAt.getTime();
  let due: number;
  if (rung === 1) due = start + s["nudge.firstDelayMin"] * MIN;
  else if (rung === 2) due = start + s["nudge.secondDelayMin"] * MIN;
  else if (rung === ESCALATION_RUNG) due = start + s["nudge.escalateAfterMin"] * MIN;
  else due = (inc.escalatedAt?.getTime() ?? start + s["nudge.escalateAfterMin"] * MIN) + (rung - ESCALATION_RUNG) * DAY;
  return new Date(Math.max(due, now().getTime()));
}

export async function scheduleRung(incidentId: string, rung: number, at: Date) {
  await queue().send(JOBS.nudge, { incidentId, rung }, { startAfter: at, singletonKey: `${incidentJobPrefix(incidentId)}rung${rung}` });
}

/**
 * The single entry point for every status signal (§6). Runs under a row lock on the
 * LinkedInAccount so webhook and reconciler calls serialise. Side effects (jobs,
 * messages) run after commit.
 */
export async function applyStatus(
  linkedinAccountId: string,
  rawStatus: string,
  source: StatusSource,
  opts: { payload?: Prisma.InputJsonValue; promote?: boolean } = {},
): Promise<void> {
  const settings = await getAllSettings();
  const effects: Effect[] = [];

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "LinkedInAccount" WHERE id = ${linkedinAccountId} FOR UPDATE`;
    const acct = await tx.linkedInAccount.findUnique({ where: { id: linkedinAccountId }, include: { person: true } });
    if (!acct) return;

    let next: LinkStatus = normalize(rawStatus);
    // An ERROR past its grace period stays NEEDS_RECONNECT; a repeat ERROR must not demote it.
    if (next === "TRANSIENT_ERROR" && (opts.promote || (acct.status === "NEEDS_RECONNECT" && acct.lastRawStatus === rawStatus))) {
      next = "NEEDS_RECONNECT";
    }

    await tx.connectionEvent.create({
      data: { accountId: acct.id, rawStatus, normalized: next, source, payload: opts.payload },
    });

    // Idempotency guard: a repeat of the last raw status from an automatic source changes nothing.
    const unchanged = acct.lastRawStatus === rawStatus && acct.status === next;
    if (unchanged && (source === "reconciler" || source === "webhook")) return;

    const t = now();
    await tx.linkedInAccount.update({
      where: { id: acct.id },
      data: { status: next, lastRawStatus: rawStatus, lastStatusAt: t, ...(next === "CONNECTED" && !acct.connectedAt ? { connectedAt: t } : {}) },
    });

    const person = acct.person;
    const open = await tx.incident.findFirst({ where: { personId: person.id, resolvedAt: null }, orderBy: { startedAt: "desc" } });

    const resolve = async (inc: Incident, reason: string) => {
      await tx.incident.update({ where: { id: inc.id }, data: { resolvedAt: t } });
      effects.push({ kind: "cancel", incidentId: inc.id });
      await audit({ action: "incident.resolve", targetType: "person", targetId: person.id, metadata: { incidentId: inc.id, reason } }, tx);
    };

    // Resolution applies whatever the person's status; opening and nudging only for ACTIVE people.
    if (next === "CONNECTED") {
      if (open) {
        await resolve(open, rawStatus);
        if (person.status === "ACTIVE") effects.push({ kind: "notify", personId: person.id, template: "reconnected", incidentId: open.id });
      }
      return;
    }

    if (next === "DELETED") {
      if (open) await resolve(open, "DELETED");
      await audit({ action: "linkedin.deleted_externally", targetType: "person", targetId: person.id, metadata: { unipileAccountId: acct.unipileAccountId } }, tx);
      if (["ACTIVE", "PENDING_REVIEW", "SUSPENDED"].includes(person.status)) {
        effects.push({ kind: "flag", personId: person.id, message: `LinkedIn account for ${person.fullName ?? person.id} was deleted in Unipile.` });
      }
      return;
    }

    if (next === "CONNECTING" || person.status !== "ACTIVE") return; // record only (§6 step 2)

    if (next === "TRANSIENT_ERROR") {
      if (!open) {
        const inc = await tx.incident.create({ data: { personId: person.id, startedAt: t, cause: rawStatus } });
        effects.push({ kind: "promote", incidentId: inc.id, at: new Date(t.getTime() + settings["nudge.errorGraceMin"] * MIN) });
      }
      return;
    }

    // NEEDS_RECONNECT
    if (open) {
      if (open.nudgeCount === 0) effects.push({ kind: "schedule", incidentId: open.id, rung: 1, at: t });
      return;
    }
    const lastResolved = await tx.incident.findFirst({
      where: { personId: person.id, resolvedAt: { not: null } },
      orderBy: { resolvedAt: "desc" },
    });
    const flapCutoff = t.getTime() - settings["nudge.flapWindowMin"] * MIN;
    if (lastResolved && lastResolved.resolvedAt!.getTime() >= flapCutoff) {
      const reopened = await tx.incident.update({ where: { id: lastResolved.id }, data: { resolvedAt: null } });
      const rung = reopened.nudgeCount + 1;
      if (reopened.nudgeCount < settings["nudge.maxNudges"]) {
        effects.push({ kind: "schedule", incidentId: reopened.id, rung, at: rungDueAt(reopened, rung, settings) });
      }
      log.info("flap: reopened incident", { incidentId: reopened.id, rung });
      return;
    }
    const inc = await tx.incident.create({ data: { personId: person.id, startedAt: t, cause: rawStatus } });
    effects.push({ kind: "schedule", incidentId: inc.id, rung: 1, at: rungDueAt(inc, 1, settings) });
  });

  for (const e of effects) {
    try {
      if (e.kind === "schedule") await scheduleRung(e.incidentId, e.rung, e.at);
      else if (e.kind === "promote") await queue().send(JOBS.promoteError, { incidentId: e.incidentId }, { startAfter: e.at, singletonKey: `${incidentJobPrefix(e.incidentId)}promote` });
      else if (e.kind === "cancel") await queue().cancelByPrefix(incidentJobPrefix(e.incidentId));
      else if (e.kind === "notify") await notify(e.personId, e.template, {}, { incidentId: e.incidentId });
      else if (e.kind === "flag") await db.adminFlag.create({ data: { kind: "linkedin_deleted", personId: e.personId, message: e.message } });
    } catch (err) {
      // Jobs re-check state when they run, so a lost side effect is caught by the next signal or the reconciler.
      log.error("applyStatus side effect failed", { effect: e.kind, err });
    }
  }
}
