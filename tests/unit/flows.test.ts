import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { clock, DAY, HOUR, MIN, now } from "@/lib/clock";
import type { MemoryQueue } from "@/lib/queue";
import { setState } from "@/lib/settings";
import { reconcile } from "@/lib/monitoring/reconciler";
import { handleHostedAuthNotify } from "@/lib/monitoring/notifyCallback";
import { applyStatus } from "@/lib/monitoring/applyStatus";
import { findReconnectToken, mintReconnectLink } from "@/lib/monitoring/tokens";
import { startReconnect } from "@/lib/monitoring/reconnect";
import { monthlyUptime } from "@/lib/monitoring/uptime";
import { approve, offboard, reactivate, reject, suspend } from "@/lib/person/lifecycle";
import { sendWhatsAppOtp, verifyWhatsAppOtp } from "@/lib/otp";
import { notify, WA_HOURLY_CAP } from "@/lib/notify";
import { runRetention } from "@/lib/retention";
import { publish, createDraft, needsTosAcceptance } from "@/lib/tos";
import type { FakeUnipileClient } from "@/lib/unipile/fake";
import { incidents, makePerson, openIncident, sentTemplates, setupWorld, type FakeWa } from "../helpers";

let q: MemoryQueue;
let wa: FakeWa;
let unipile: FakeUnipileClient;

beforeEach(async () => {
  ({ q, wa, unipile } = await setupWorld());
});

describe("reconciler (§7)", () => {
  it("a missed webhook: the reconciler opens the incident", async () => {
    const { person, acct } = await makePerson();
    await db.fakeUnipileAccount.update({ where: { id: acct.unipileAccountId }, data: { status: "CREDENTIALS" } });
    const r = await reconcile();
    expect(r.changed).toBe(1);
    expect(await openIncident(person)).not.toBeNull();
    expect((await db.connectionEvent.findFirstOrThrow({ where: { accountId: acct.id } })).source).toBe("reconciler");
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["nudge_1"]);
  });

  it("an unchanged status does nothing (idempotent)", async () => {
    const { acct } = await makePerson();
    expect((await reconcile()).changed).toBe(0);
    expect(await db.connectionEvent.count({ where: { accountId: acct.id } })).toBe(0);
  });

  it("Unipile down: logs and skips, never marks accounts DELETED", async () => {
    const { person, acct } = await makePerson();
    await setState("fake.unipileDown", true);
    const r = await reconcile();
    expect(r.skipped).toBe(true);
    expect((await db.linkedInAccount.findUniqueOrThrow({ where: { id: acct.id } })).status).toBe("CONNECTED");
    expect(await incidents(person)).toHaveLength(0);
  });

  it("missing remotely (and the list call worked): treated as DELETED", async () => {
    const { person, acct } = await makePerson();
    await db.fakeUnipileAccount.delete({ where: { id: acct.unipileAccountId } });
    await reconcile();
    expect((await db.linkedInAccount.findUniqueOrThrow({ where: { id: acct.id } })).status).toBe("DELETED");
    expect(await db.adminFlag.count({ where: { personId: person.id } })).toBe(1);
  });

  it("counts orphan Unipile accounts and doesn't delete them", async () => {
    await makePerson();
    await db.fakeUnipileAccount.create({ data: { id: "orphan_1", name: "x", providerUserId: "x", publicId: "x", status: "OK" } });
    expect((await reconcile()).orphans).toBe(1);
    expect(await db.fakeUnipileAccount.count({ where: { id: "orphan_1" } })).toBe(1);
  });

  it("writes the worker heartbeat", async () => {
    await reconcile();
    expect(await db.setting.findUnique({ where: { key: "worker.heartbeat" } })).not.toBeNull();
  });
});

describe("hosted-auth notify callback (§4.1)", () => {
  async function applicantAtLinkedInStep() {
    const user = await db.user.create({ data: { email: `a${Math.random()}@example.test` } });
    return db.person.create({ data: { userId: user.id, onboardingStep: 3, fullName: "New Applicant" } });
  }

  it("confirms with getAccount, stores the account, moves to the review step", async () => {
    const p = await applicantAtLinkedInStep();
    await db.fakeUnipileAccount.create({ data: { id: "acc_new", name: "New Applicant", providerUserId: "li-new", publicId: "new-applicant", status: "OK" } });
    const r = await handleHostedAuthNotify({ status: "CREATION_SUCCESS", account_id: "acc_new", name: p.id });
    expect(r.ok).toBe(true);
    const acct = await db.linkedInAccount.findUniqueOrThrow({ where: { personId: p.id } });
    expect(acct).toMatchObject({ unipileAccountId: "acc_new", status: "CONNECTED", profileUrl: "https://www.linkedin.com/in/new-applicant" });
    expect((await db.person.findUniqueOrThrow({ where: { id: p.id } })).onboardingStep).toBe(4);
    expect((await db.connectionEvent.findFirstOrThrow({ where: { accountId: acct.id } })).source).toBe("notify_url");
  });

  it("forged body (account doesn't exist at Unipile): rejected, nothing stored", async () => {
    const p = await applicantAtLinkedInStep();
    const r = await handleHostedAuthNotify({ status: "CREATION_SUCCESS", account_id: "made_up", name: p.id });
    expect(r).toEqual({ ok: false, reason: "account_not_found" });
    expect(await db.linkedInAccount.count()).toBe(0);
  });

  it("forged body (unknown person): rejected", async () => {
    await db.fakeUnipileAccount.create({ data: { id: "acc_x", name: "x", providerUserId: "x", publicId: "x", status: "OK" } });
    expect((await handleHostedAuthNotify({ status: "CREATION_SUCCESS", account_id: "acc_x", name: "nobody" })).ok).toBe(false);
  });

  it("the same LinkedIn connected by a second applicant: blocked, its Unipile account deleted, flagged", async () => {
    const { person: first } = await makePerson({ status: "PENDING_REVIEW" });
    const second = await applicantAtLinkedInStep();
    const firstAcct = await db.linkedInAccount.findUniqueOrThrow({ where: { personId: first.id } });
    await db.fakeUnipileAccount.create({ data: { id: "acc_dupe", name: "Same", providerUserId: firstAcct.providerUserId!, publicId: "other", status: "OK" } });
    const r = await handleHostedAuthNotify({ status: "CREATION_SUCCESS", account_id: "acc_dupe", name: second.id });
    expect(r.reason).toBe("duplicate_linkedin");
    expect(await db.fakeUnipileAccount.count({ where: { id: "acc_dupe" } })).toBe(0);
    expect((await db.person.findUniqueOrThrow({ where: { id: second.id } })).linkedinError).toBe("duplicate_linkedin");
    expect(await db.auditLog.count({ where: { action: "linkedin.duplicate_blocked" } })).toBe(1);
    expect(await db.adminFlag.count({ where: { kind: "duplicate_linkedin" } })).toBe(1);
  });

  it("a repeated callback is harmless", async () => {
    const p = await applicantAtLinkedInStep();
    await db.fakeUnipileAccount.create({ data: { id: "acc_r", name: "R", providerUserId: "li-r", publicId: "r", status: "OK" } });
    await handleHostedAuthNotify({ status: "CREATION_SUCCESS", account_id: "acc_r", name: p.id });
    const again = await handleHostedAuthNotify({ status: "CREATION_SUCCESS", account_id: "acc_r", name: p.id });
    expect(again.ok).toBe(true); // same account = treated as a reconnect of it
    expect(await db.linkedInAccount.count()).toBe(1);
  });

  it("RECONNECTED for an active employee resolves their incident", async () => {
    const { person, acct } = await makePerson();
    await applyStatus(acct.id, "CREDENTIALS", "webhook");
    const r = await handleHostedAuthNotify({ status: "RECONNECTED", account_id: acct.unipileAccountId, name: person.id });
    expect(r.ok).toBe(true);
    expect(await openIncident(person)).toBeNull();
  });
});

describe("reconnect links (§10)", () => {
  it("valid token -> fresh Unipile reconnect link; already connected -> friendly page", async () => {
    const { person, acct } = await makePerson();
    const link = await mintReconnectLink(person.id);
    const token = link.split("/r/")[1];
    expect((await findReconnectToken(token))?.personId).toBe(person.id);
    expect(await startReconnect(person.id)).toEqual({ kind: "already_connected" });
    await applyStatus(acct.id, "CREDENTIALS", "webhook");
    const r = await startReconnect(person.id);
    expect(r.kind).toBe("redirect");
    expect(r.kind === "redirect" && r.url).toContain(`account=${acct.unipileAccountId}`);
  });

  it("the DB stores only an HMAC of the token", async () => {
    const { person } = await makePerson();
    const token = (await mintReconnectLink(person.id)).split("/r/")[1];
    expect(await db.reconnectToken.count({ where: { id: token } })).toBe(0);
    expect(await findReconnectToken("not-a-real-token-but-long-enough")).toBeNull();
  });

  it("expires after the TTL", async () => {
    const { person } = await makePerson();
    const token = (await mintReconnectLink(person.id)).split("/r/")[1];
    const t = await findReconnectToken(token);
    expect(t!.expiresAt.getTime() - now().getTime()).toBe(72 * HOUR);
  });
});

describe("lifecycle (§9, §10)", () => {
  async function adminUser() {
    return db.user.create({ data: { email: `admin${Math.random()}@example.test`, role: "SUPER_ADMIN" } });
  }

  it("approve: active, EMPLOYEE role, audited, welcome message; already disconnected -> incident starts now", async () => {
    const admin = await adminUser();
    const { person, acct } = await makePerson({ status: "PENDING_REVIEW" });
    await applyStatus(acct.id, "CREDENTIALS", "webhook"); // dropped while pending: recorded only
    expect(await incidents(person)).toHaveLength(0);
    await approve(person.id, admin.id);
    const p = await db.person.findUniqueOrThrow({ where: { id: person.id }, include: { user: true } });
    expect(p.status).toBe("ACTIVE");
    expect(p.user.role).toBe("EMPLOYEE");
    expect(p.activatedAt).not.toBeNull();
    expect(await openIncident(person)).not.toBeNull();
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["approved", "nudge_1"]);
    expect(await db.auditLog.count({ where: { action: "person.approve" } })).toBe(1);
  });

  it("reject: reason required, Unipile account deleted, purge date set, generic message", async () => {
    const admin = await adminUser();
    const { person, acct } = await makePerson({ status: "PENDING_REVIEW" });
    await expect(reject(person.id, admin.id, "  ")).rejects.toThrow(/reason/);
    await reject(person.id, admin.id, "Profile too new");
    const p = await db.person.findUniqueOrThrow({ where: { id: person.id } });
    expect(p.status).toBe("REJECTED");
    expect(p.purgeAfter!.getTime() - now().getTime()).toBe(30 * DAY);
    expect(await db.fakeUnipileAccount.count({ where: { id: acct.unipileAccountId } })).toBe(0);
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["rejected"]);
  });

  it("reject when Unipile delete fails: retried by a job", async () => {
    const admin = await adminUser();
    const { person, acct } = await makePerson({ status: "PENDING_REVIEW" });
    const orig = unipile.deleteAccount.bind(unipile);
    let calls = 0;
    unipile.deleteAccount = async (id: string) => {
      if (calls++ === 0) throw new Error("Unipile 503");
      return orig(id);
    };
    await reject(person.id, admin.id, "No");
    expect(q.pending("delete-unipile-account")).toHaveLength(1);
    await q.runDue();
    expect(await db.fakeUnipileAccount.count({ where: { id: acct.unipileAccountId } })).toBe(0);
  });

  it("rejected applicant data is purged after 30 days, leaving a PII-free audit entry", async () => {
    const admin = await adminUser();
    const { person } = await makePerson({ status: "PENDING_REVIEW" });
    await reject(person.id, admin.id, "No");
    await q.runDue();
    clock.advance(29 * DAY);
    expect((await runRetention()).rejectedPurged).toBe(0);
    clock.advance(1 * DAY + MIN);
    expect((await runRetention()).rejectedPurged).toBe(1);
    expect(await db.person.count({ where: { id: person.id } })).toBe(0);
    expect(await db.notification.count({ where: { personId: person.id } })).toBe(0);
    const purged = await db.auditLog.findFirstOrThrow({ where: { action: "person.purged" } });
    expect(purged.metadata).toBeNull();
  });

  it("suspend stops nudges but keeps monitoring; reactivate resumes the ladder", async () => {
    const admin = await adminUser();
    const { person, acct } = await makePerson();
    await applyStatus(acct.id, "CREDENTIALS", "webhook");
    await q.runDue(); // nudge_1
    await suspend(person.id, admin.id);
    expect(q.pending("nudge")).toHaveLength(0);
    clock.advance(3 * HOUR);
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["nudge_1"]);
    await reactivate(person.id, admin.id);
    await q.runDue(); // rung 2 is overdue -> sent now
    expect(await sentTemplates(person.id)).toEqual(["nudge_1", "nudge_2"]);
    expect(await incidents(person)).toHaveLength(1);
  });

  it("offboard: resolves the incident, cancels jobs, deletes the Unipile account", async () => {
    const admin = await adminUser();
    const { person, acct } = await makePerson();
    await applyStatus(acct.id, "CREDENTIALS", "webhook");
    await offboard(person.id, admin.id);
    expect(await openIncident(person)).toBeNull();
    expect(q.pending("nudge")).toHaveLength(0);
    expect(await db.fakeUnipileAccount.count({ where: { id: acct.unipileAccountId } })).toBe(0);
    expect((await db.person.findUniqueOrThrow({ where: { id: person.id } })).status).toBe("OFFBOARDED");
  });
});

describe("uptime (§6)", () => {
  it("down time is the incidents clipped to the active window; open incidents run to now", async () => {
    clock.set(new Date("2026-03-20T18:30:00Z")); // 21 Mar 00:00 IST
    const { person } = await makePerson({ activatedAt: new Date("2026-03-10T18:30:00Z") }); // 11 Mar 00:00 IST
    await db.incident.create({ data: { personId: person.id, cause: "CREDENTIALS", startedAt: new Date("2026-03-05T00:00:00Z"), resolvedAt: new Date("2026-03-11T18:30:00Z") } }); // 1 day inside
    await db.incident.create({ data: { personId: person.id, cause: "ERROR", startedAt: new Date("2026-03-20T12:30:00Z") } }); // open, 6 h so far
    const u = await monthlyUptime(person.id, 2026, 3);
    expect(u.activeSeconds).toBe(10 * 24 * 3600);
    expect(u.downSeconds).toBe(24 * 3600 + 6 * 3600);
    expect(u.uptimePct).toBe(87.5);
  });

  it("not activated yet: no uptime", async () => {
    const { person } = await makePerson({ status: "PENDING_REVIEW" });
    expect((await monthlyUptime(person.id, 2026, 3)).uptimePct).toBeNull();
  });
});

describe("WhatsApp OTP (§8 step 2)", () => {
  async function draftPerson() {
    const user = await db.user.create({ data: { email: `o${Math.random()}@example.test` } });
    return db.person.create({ data: { userId: user.id, onboardingStep: 2 } });
  }

  it("send, wrong code, right code -> verified; codes are hashed", async () => {
    const p = await draftPerson();
    // The onWhatsApp check goes to the worker over RPC; answer it like the worker would.
    const answer = setInterval(async () => {
      const cmds = await db.workerCommand.findMany({ where: { status: "pending" } });
      for (const c of cmds) await db.workerCommand.update({ where: { id: c.id }, data: { status: "done", result: { exists: true } } });
    }, 100);
    try {
      await sendWhatsAppOtp(p.id, "+919876500001");
    } finally {
      clearInterval(answer);
    }
    await q.runDue();
    const code = wa.sent[0].body.match(/\d{6}/)![0];
    const row = await db.otpCode.findFirstOrThrow();
    expect(row.codeHash).not.toContain(code);
    const logged = await db.notification.findFirstOrThrow({ where: { templateKey: "otp" } });
    expect(logged.status).toBe("sent");
    expect(logged.body).not.toContain(code); // redacted once sent
    await expect(verifyWhatsAppOtp(p.id, "+919876500001", code === "000000" ? "111111" : "000000")).rejects.toThrow(/isn't right/);
    await verifyWhatsAppOtp(p.id, "+919876500001", code);
    const after = await db.person.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.whatsappE164).toBe("+919876500001");
    expect(after.whatsappVerifiedAt).not.toBeNull();
  });

  it("max 3 sends per hour per number, 5 attempts per code, 10 minute expiry", async () => {
    const p = await draftPerson();
    await db.person.update({ where: { id: p.id }, data: { whatsappE164: "+919876500002", whatsappOnWa: true } });
    for (let i = 0; i < 3; i++) await sendWhatsAppOtp(p.id, "+919876500002");
    await expect(sendWhatsAppOtp(p.id, "+919876500002")).rejects.toThrow(/Too many codes/);
    for (let i = 0; i < 5; i++) await expect(verifyWhatsAppOtp(p.id, "+919876500002", "999999")).rejects.toThrow();
    await expect(verifyWhatsAppOtp(p.id, "+919876500002", "999999")).rejects.toThrow(/Too many wrong attempts/);
    clock.advance(11 * MIN);
    await expect(verifyWhatsAppOtp(p.id, "+919876500002", "123456")).rejects.toThrow(/expired/);
  });

  it("OTPs go over WhatsApp only (no email fallback) and ignore quiet hours", async () => {
    clock.set(new Date("2026-03-10T18:00:00Z")); // 23:30 IST
    const p = await draftPerson();
    await db.person.update({ where: { id: p.id }, data: { whatsappE164: "+919876500003", whatsappOnWa: true } });
    await sendWhatsAppOtp(p.id, "+919876500003");
    await q.runDue();
    const rows = await db.notification.findMany({ where: { templateKey: "otp" } });
    expect(rows.map((r) => [r.channel, r.status])).toEqual([["whatsapp", "sent"]]);
  });
});

describe("notifier limits", () => {
  it(`stops at ${WA_HOURLY_CAP} WhatsApp messages an hour and sends the rest later`, async () => {
    const { person } = await makePerson();
    for (let i = 0; i < WA_HOURLY_CAP + 2; i++) await notify(person.id, "test", { channel: "WhatsApp" }, { bypassQuietHours: true });
    await q.runDue();
    expect(wa.sent).toHaveLength(WA_HOURLY_CAP);
    clock.advance(HOUR + 2000);
    await q.runDue();
    expect(wa.sent).toHaveLength(WA_HOURLY_CAP + 2);
  });

  it("a WhatsApp send that fails 3 times falls back to email", async () => {
    const { person } = await makePerson();
    wa.failNext = 99;
    await notify(person.id, "reconnected");
    // pg-boss would retry; the memory queue surfaces the throw, so retry by hand.
    for (let i = 0; i < 3; i++) {
      await q.runDue().catch(() => {});
      const n = await db.notification.findFirstOrThrow({ where: { channel: "whatsapp" } });
      if (n.status === "queued") await q.send("deliver-notification", { notificationId: n.id, fallbacks: [{ channel: "email", to: "x@example.test" }] });
    }
    await q.runDue();
    const rows = await db.notification.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.channel, r.status])).toEqual([
      ["whatsapp", "failed"],
      ["email", "sent"],
    ]);
  });
});

describe("TOS versioning (§10, §11)", () => {
  it("publishing a new version gates employees in the UI and leaves monitoring alone", async () => {
    const admin = await db.user.create({ data: { email: "tos@example.test", role: "SUPER_ADMIN" } });
    const v1 = await createDraft("# Terms v1\n\nOriginal terms text here.", admin.id);
    await publish(v1.id, admin.id);
    const { person, acct } = await makePerson();
    await db.tosAcceptance.create({ data: { personId: person.id, tosVersionId: v1.id, ip: "1.1.1.1", userAgent: "t" } });
    expect(await needsTosAcceptance(person.id)).toBe(false);
    const v2 = await createDraft("# Terms v2\n\nUpdated terms text here.", admin.id);
    await publish(v2.id, admin.id);
    expect(await needsTosAcceptance(person.id)).toBe(true);
    expect(await db.tosVersion.count({ where: { isCurrent: true } })).toBe(1);
    await applyStatus(acct.id, "CREDENTIALS", "webhook");
    await q.runDue();
    expect(await sentTemplates(person.id)).toEqual(["tos_updated", "nudge_1"]);
  });
});
