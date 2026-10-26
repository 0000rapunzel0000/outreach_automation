import { vi } from "vitest";
import type { Person, PersonStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { clock } from "@/lib/clock";
import { MemoryQueue, setQueue } from "@/lib/queue";
import { deliverNotification, setEmailProvider, setWhatsAppProvider } from "@/lib/notify";
import type { NotifyProvider, WhatsAppProvider } from "@/lib/notify/providers/types";
import { deleteUnipileAccountJob, nudgeJob, promoteErrorJob } from "@/lib/monitoring/jobs";
import { setUnipileClient } from "@/lib/unipile";
import { FakeUnipileClient } from "@/lib/unipile/fake";

export class FakeWa implements WhatsAppProvider {
  channel = "whatsapp" as const;
  healthy = true;
  failNext = 0;
  sent: { to: string; body: string }[] = [];
  async isHealthy() {
    return this.healthy;
  }
  async onWhatsApp() {
    return true;
  }
  async send(to: string, body: string) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("wa send failed");
    }
    this.sent.push({ to, body });
    return { providerMessageId: `wa-${this.sent.length}` };
  }
}

export class FakeEmail implements NotifyProvider {
  channel = "email" as const;
  sent: { to: string; body: string; subject?: string }[] = [];
  async isHealthy() {
    return true;
  }
  async send(to: string, body: string, subject?: string) {
    this.sent.push({ to, body, subject });
    return { providerMessageId: `em-${this.sent.length}` };
  }
}

const TABLES = [
  "AuditLog", "ConnectionEvent", "Incident", "Notification", "ReconnectToken", "TosAcceptance", "TosVersion", "OtpCode",
  "LinkedInAccount", "Person", "Session", "User", "WaAuthState", "Setting", "AdminFlag", "WorkerCommand", "RateLimit", "FakeUnipileAccount",
];

export async function resetDb() {
  await db.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
}

/** Fresh world per test: empty DB, memory queue running real handlers, fake WA/email/Unipile, clock at a fixed daytime instant. */
export async function setupWorld(at = new Date("2026-03-10T06:30:00Z") /* 12:00 IST, outside quiet hours */) {
  await resetDb();
  clock.set(at);
  const q = new MemoryQueue();
  q.setHandlers({
    "deliver-notification": deliverNotification,
    nudge: nudgeJob,
    "promote-error": promoteErrorJob,
    "delete-unipile-account": deleteUnipileAccountJob,
  });
  setQueue(q);
  const wa = new FakeWa();
  const email = new FakeEmail();
  setWhatsAppProvider(wa);
  setEmailProvider(email);
  const unipile = new FakeUnipileClient();
  setUnipileClient(unipile);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  return { q, wa, email, unipile };
}

let seq = 0;

/** A person with a connected LinkedIn account (fake Unipile row + local row). */
export async function makePerson(opts: { status?: PersonStatus; rawStatus?: string; activatedAt?: Date } = {}) {
  seq++;
  const status = opts.status ?? "ACTIVE";
  const user = await db.user.create({ data: { email: `p${seq}-${Date.now()}@example.test`, role: status === "ACTIVE" ? "EMPLOYEE" : "APPLICANT" } });
  const person = await db.person.create({
    data: {
      userId: user.id,
      status,
      fullName: `Priya Test${seq}`,
      whatsappE164: `+9198765${String(10000 + seq).slice(-5)}`,
      whatsappVerifiedAt: new Date(),
      onboardingStep: 4,
      activatedAt: status === "ACTIVE" ? (opts.activatedAt ?? new Date("2026-03-01T00:00:00Z")) : null,
    },
  });
  const unipileAccountId = `fake_acct_${seq}`;
  await db.fakeUnipileAccount.create({ data: { id: unipileAccountId, name: person.fullName!, providerUserId: `li-${seq}`, publicId: `li-${seq}`, status: opts.rawStatus ?? "OK" } });
  const acct = await db.linkedInAccount.create({
    data: {
      personId: person.id,
      unipileAccountId,
      providerUserId: `li-${seq}`,
      profileUrl: `https://www.linkedin.com/in/li-${seq}`,
      displayName: person.fullName,
      status: "CONNECTED",
      lastRawStatus: opts.rawStatus ?? "OK",
      connectedAt: new Date(),
    },
  });
  return { user, person, acct };
}

export async function openIncident(person: Pick<Person, "id">) {
  return db.incident.findFirst({ where: { personId: person.id, resolvedAt: null } });
}

export async function incidents(person: Pick<Person, "id">) {
  return db.incident.findMany({ where: { personId: person.id }, orderBy: { startedAt: "asc" } });
}

export async function sentTemplates(personId: string) {
  return (await db.notification.findMany({ where: { personId, status: "sent" }, orderBy: { createdAt: "asc" } })).map((n) => n.templateKey);
}
