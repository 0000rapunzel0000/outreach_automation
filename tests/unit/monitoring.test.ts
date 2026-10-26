import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { clock, DAY, HOUR, MIN } from "@/lib/clock";
import type { MemoryQueue } from "@/lib/queue";
import { applyStatus } from "@/lib/monitoring/applyStatus";
import { incidents, makePerson, openIncident, sentTemplates, setupWorld, type FakeWa } from "../helpers";

let q: MemoryQueue;
let wa: FakeWa;

beforeEach(async () => {
  ({ q, wa } = await setupWorld());
});

async function drop(acctId: string, raw = "CREDENTIALS", source: "webhook" | "reconciler" = "webhook") {
  await applyStatus(acctId, raw, source);
}

describe("§6 transition table", () => {
  it("CONNECTED with an open incident: resolves, cancels jobs, sends 'reconnected', audits", async () => {
    const { person, acct } = await makePerson();
    await drop(acct.id);
    await q.runDue(); // rung 1 sent
    expect(q.pending("nudge")).toHaveLength(1); // rung 2 waiting
    await applyStatus(acct.id, "OK", "webhook");
    const inc = (await incidents(person))[0];
    expect(inc.resolvedAt).not.toBeNull();
    expect(q.pending("nudge")).toHaveLength(0);
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["nudge_1", "reconnected"]);
    expect(await db.auditLog.count({ where: { action: "incident.resolve", targetId: person.id } })).toBe(1);
  });

  it("CONNECTED with no open incident: nothing", async () => {
    const { person, acct } = await makePerson({ rawStatus: "SYNC_SUCCESS" });
    await applyStatus(acct.id, "OK", "webhook");
    expect(await incidents(person)).toHaveLength(0);
    expect(q.jobs).toHaveLength(0);
  });

  it("CONNECTING: nothing", async () => {
    const { person, acct } = await makePerson();
    await applyStatus(acct.id, "CONNECTING", "webhook");
    expect(await incidents(person)).toHaveLength(0);
    expect((await db.linkedInAccount.findUniqueOrThrow({ where: { id: acct.id } })).status).toBe("CONNECTING");
  });

  it("TRANSIENT_ERROR with no incident: opens one, schedules promote-error at +grace, no nudge", async () => {
    const { person, acct } = await makePerson();
    await applyStatus(acct.id, "ERROR", "webhook");
    const inc = await openIncident(person);
    expect(inc?.cause).toBe("ERROR");
    const promote = q.pending("promote-error");
    expect(promote).toHaveLength(1);
    expect(promote[0].startAfter.toISOString()).toBe("2026-03-10T06:40:00.000Z");
    expect(q.pending("nudge")).toHaveLength(0);
  });

  it("TRANSIENT_ERROR with an open incident: nothing new", async () => {
    const { person, acct } = await makePerson();
    await applyStatus(acct.id, "ERROR", "webhook");
    await applyStatus(acct.id, "CONNECTING", "webhook");
    await applyStatus(acct.id, "ERROR", "webhook");
    expect(await incidents(person)).toHaveLength(1);
    expect(q.pending("promote-error")).toHaveLength(1);
  });

  it("NEEDS_RECONNECT with no incident: opens one and sends rung 1 after firstDelayMin", async () => {
    const { person, acct } = await makePerson();
    await drop(acct.id, "STOPPED");
    expect((await openIncident(person))?.cause).toBe("STOPPED");
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["nudge_1"]);
    expect(wa.sent[0].body).toMatch(/http:\/\/localhost:3999\/r\/[A-Za-z0-9_-]{40,}/);
  });

  it("NEEDS_RECONNECT within the flap window: reopens the same incident, no ladder restart", async () => {
    const { person, acct } = await makePerson();
    await drop(acct.id);
    await q.runDue(); // nudge_1
    await applyStatus(acct.id, "OK", "webhook");
    clock.advance(20 * MIN);
    await drop(acct.id);
    const all = await incidents(person);
    expect(all).toHaveLength(1);
    expect(all[0].resolvedAt).toBeNull();
    // Next rung is rung 2 (at start + 2h), not rung 1 again.
    const pending = q.pending("nudge");
    expect(pending).toHaveLength(1);
    expect(pending[0].data.rung).toBe(2);
    await q.runDue();
    expect((await sentTemplates(person.id)).filter((t) => t.startsWith("nudge"))).toEqual(["nudge_1"]);
  });

  it("NEEDS_RECONNECT outside the flap window: a new incident and a fresh ladder", async () => {
    const { person, acct } = await makePerson();
    await drop(acct.id);
    await q.runDue();
    await applyStatus(acct.id, "OK", "webhook");
    clock.advance(31 * MIN);
    await drop(acct.id);
    expect(await incidents(person)).toHaveLength(2);
    expect(q.pending("nudge")[0].data.rung).toBe(1);
  });

  it("NEEDS_RECONNECT on an incident opened as transient: schedules rung 1 now", async () => {
    const { person, acct } = await makePerson();
    await applyStatus(acct.id, "ERROR", "webhook");
    clock.advance(3 * MIN);
    await drop(acct.id, "CREDENTIALS");
    expect(await incidents(person)).toHaveLength(1);
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["nudge_1"]);
  });

  it("NEEDS_RECONNECT while already nudging: nothing", async () => {
    const { person, acct } = await makePerson();
    await drop(acct.id, "CREDENTIALS");
    await q.runDue();
    await drop(acct.id, "STOPPED");
    expect(await incidents(person)).toHaveLength(1);
    expect(q.pending("nudge")).toHaveLength(1); // still just rung 2
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["nudge_1"]);
  });

  it("DELETED: resolves the incident, audits, flags for admins", async () => {
    const { person, acct } = await makePerson();
    await drop(acct.id);
    await applyStatus(acct.id, "DELETED", "webhook");
    expect(await openIncident(person)).toBeNull();
    expect(await db.auditLog.count({ where: { action: "linkedin.deleted_externally" } })).toBe(1);
    expect(await db.adminFlag.count({ where: { personId: person.id } })).toBe(1);
    expect(q.pending("nudge")).toHaveLength(0);
  });

  it("people who aren't ACTIVE: status recorded, no incident or nudge", async () => {
    const { person, acct } = await makePerson({ status: "PENDING_REVIEW" });
    await drop(acct.id);
    expect((await db.linkedInAccount.findUniqueOrThrow({ where: { id: acct.id } })).status).toBe("NEEDS_RECONNECT");
    expect(await incidents(person)).toHaveLength(0);
    expect(q.jobs).toHaveLength(0);
  });
});

describe("nudge ladder", () => {
  it("rung 1 at T0, rung 2 at T+2h, escalation at T+24h (admins alerted), then daily, stopping at maxNudges", async () => {
    const admin = await db.user.create({ data: { email: "boss@example.test", role: "SUPER_ADMIN", whatsappE164: "+919999900000" } });
    const { person, acct } = await makePerson();
    await drop(acct.id);
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["nudge_1"]);

    clock.advance(119 * MIN);
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["nudge_1"]);
    clock.advance(1 * MIN);
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["nudge_1", "nudge_2"]);

    clock.advance(22 * HOUR);
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["nudge_1", "nudge_2", "nudge_final"]);
    const inc = (await openIncident(person))!;
    expect(inc.escalatedAt).not.toBeNull();
    const adminMsgs = await db.notification.findMany({ where: { templateKey: "admin_escalation", status: "sent" } });
    expect(adminMsgs.map((n) => n.toAddress)).toContain(admin.whatsappE164);

    // Daily reminders until maxNudges (10) total.
    for (let d = 0; d < 10; d++) {
      clock.advance(DAY);
      await q.runDue();
    }
    const nudges = (await sentTemplates(person.id)).filter((t) => t.startsWith("nudge"));
    expect(nudges).toHaveLength(10);
    expect(nudges.slice(3).every((t) => t === "nudge_daily")).toBe(true);
    expect(q.pending("nudge")).toHaveLength(0);
  });

  it("a nudge due during quiet hours is deferred to 08:00 IST", async () => {
    clock.set(new Date("2026-03-10T17:00:00Z")); // 22:30 IST
    const { person, acct } = await makePerson();
    await drop(acct.id);
    await q.runDue(); // nudge job runs, message deferred
    const n = await db.notification.findFirstOrThrow({ where: { personId: person.id, templateKey: "nudge_1" } });
    expect(n.status).toBe("deferred_quiet_hours");
    expect(wa.sent).toHaveLength(0);
    clock.set(new Date("2026-03-11T02:30:00Z")); // 08:00 IST
    await q.runDue();
    expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("sent");
  });

  it("a deferred nudge is skipped if they reconnected meanwhile", async () => {
    clock.set(new Date("2026-03-10T17:00:00Z"));
    const { person, acct } = await makePerson();
    await drop(acct.id);
    await q.runDue();
    clock.set(new Date("2026-03-10T20:00:00Z")); // 01:30 IST
    await applyStatus(acct.id, "OK", "webhook");
    clock.set(new Date("2026-03-11T02:30:00Z"));
    await q.runDue();
    const n = await db.notification.findFirstOrThrow({ where: { personId: person.id, templateKey: "nudge_1" } });
    expect(n.status).toBe("skipped");
    // "reconnected" is also employee-facing, so it waited until 08:00 and then went out.
    expect(wa.sent.map((s) => s.body)).toEqual([expect.stringContaining("connected again")]);
  });
});

describe("§15 failure cases", () => {
  it("the same webhook twice: one incident, one nudge", async () => {
    const { person, acct } = await makePerson();
    await drop(acct.id);
    await drop(acct.id);
    await q.runDue();
    expect(await incidents(person)).toHaveLength(1);
    expect(await sentTemplates(person.id)).toEqual(["nudge_1"]);
  });

  it("webhook and reconciler at the same moment: the row lock serialises them", async () => {
    const { person, acct } = await makePerson();
    await Promise.all([drop(acct.id, "CREDENTIALS", "webhook"), drop(acct.id, "CREDENTIALS", "reconciler"), drop(acct.id, "CREDENTIALS", "webhook")]);
    await q.runDue();
    expect(await incidents(person)).toHaveLength(1);
    expect(await sentTemplates(person.id)).toEqual(["nudge_1"]);
  });

  it("ERROR that self-heals within the grace period: no nudge, incident resolved", async () => {
    const { person, acct } = await makePerson();
    await applyStatus(acct.id, "ERROR", "webhook");
    clock.advance(4 * MIN);
    await applyStatus(acct.id, "OK", "webhook");
    clock.advance(10 * MIN);
    await q.runDue();
    expect((await incidents(person))[0].resolvedAt).not.toBeNull();
    expect((await sentTemplates(person.id)).filter((t) => t.startsWith("nudge"))).toEqual([]);
  });

  it("ERROR past the grace period (still ERROR at Unipile): promoted and nudged", async () => {
    const { person, acct } = await makePerson();
    await db.fakeUnipileAccount.update({ where: { id: acct.unipileAccountId }, data: { status: "ERROR" } });
    await applyStatus(acct.id, "ERROR", "webhook");
    clock.advance(10 * MIN);
    await q.runDue();
    expect((await db.linkedInAccount.findUniqueOrThrow({ where: { id: acct.id } })).status).toBe("NEEDS_RECONNECT");
    expect(await sentTemplates(person.id)).toEqual(["nudge_1"]);
    // A repeat ERROR webhook must not demote it back to TRANSIENT_ERROR.
    await applyStatus(acct.id, "ERROR", "webhook");
    expect((await db.linkedInAccount.findUniqueOrThrow({ where: { id: acct.id } })).status).toBe("NEEDS_RECONNECT");
  });

  it("ERROR whose live status healed by the time promote-error runs: resolved, no nudge", async () => {
    const { person, acct } = await makePerson();
    await applyStatus(acct.id, "ERROR", "webhook"); // fake Unipile still says OK
    clock.advance(10 * MIN);
    await q.runDue();
    expect((await incidents(person))[0].resolvedAt).not.toBeNull();
    expect((await sentTemplates(person.id)).filter((t) => t.startsWith("nudge"))).toEqual([]);
  });

  it("they reconnect before a scheduled nudge fires: the job sees CONNECTED and exits", async () => {
    const { person, acct } = await makePerson();
    await drop(acct.id);
    await q.runDue();
    // Simulate a lost cancel: put rung 2 back as if it survived.
    await applyStatus(acct.id, "OK", "webhook");
    await q.send("nudge", { incidentId: (await incidents(person))[0].id, rung: 2 });
    await q.runDue();
    expect((await sentTemplates(person.id)).filter((t) => t.startsWith("nudge"))).toEqual(["nudge_1"]);
  });

  it("WhatsApp sender down: falls back to email", async () => {
    wa.healthy = false;
    const { person, acct } = await makePerson();
    await drop(acct.id);
    await q.runDue();
    const rows = await db.notification.findMany({ where: { personId: person.id, templateKey: "nudge_1" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.channel, r.status])).toEqual([
      ["whatsapp", "failed"],
      ["email", "sent"],
    ]);
    expect(rows[1].error).toContain(`fallback_for:${rows[0].id}`);
  });
});
