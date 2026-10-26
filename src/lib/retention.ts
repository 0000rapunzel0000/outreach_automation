import { db } from "@/lib/db";
import { DAY, now } from "@/lib/clock";
import { log } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";

/** Daily retention (§13). */
export async function runRetention() {
  const t = now();

  // 1. Rejected applicants past purgeAfter: hard delete, keep a PII-free audit entry.
  const toPurge = await db.person.findMany({ where: { status: "REJECTED", purgeAfter: { lte: t } }, select: { id: true, userId: true, whatsappE164: true } });
  for (const p of toPurge) await purgePerson(p);

  // Offboarded: only when a retention period is set (D4 default: never).
  const offDays = await getSetting("retention.offboardedDays");
  let offPurged = 0;
  if (offDays > 0) {
    const off = await db.person.findMany({
      where: { status: "OFFBOARDED", offboardedAt: { lte: new Date(t.getTime() - offDays * DAY) } },
      select: { id: true, userId: true, whatsappE164: true },
    });
    for (const p of off) await purgePerson(p);
    offPurged = off.length;
  }

  // 2. Old OTPs and expired reconnect tokens.
  const weekAgo = new Date(t.getTime() - 7 * DAY);
  const otps = await db.otpCode.deleteMany({ where: { createdAt: { lt: weekAgo }, OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: t } }] } });
  const tokens = await db.reconnectToken.deleteMany({ where: { expiresAt: { lt: t } } });

  // 3. Connection events older than 12 months. Incidents keep the uptime summary.
  const events = await db.connectionEvent.deleteMany({ where: { receivedAt: { lt: new Date(t.getTime() - 365 * DAY) } } });

  // Housekeeping.
  await db.workerCommand.deleteMany({ where: { createdAt: { lt: new Date(t.getTime() - DAY) } } });
  await db.session.deleteMany({ where: { expiresAt: { lt: t } } });
  await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(t.getTime() - DAY) } } });

  const summary = { rejectedPurged: toPurge.length, offboardedPurged: offPurged, otps: otps.count, tokens: tokens.count, events: events.count };
  log.info("retention run", summary);
  return summary;
}

async function purgePerson(p: { id: string; userId: string; whatsappE164: string | null }) {
  await db.$transaction(async (tx) => {
    if (p.whatsappE164) await tx.otpCode.deleteMany({ where: { phoneE164: p.whatsappE164 } });
    await tx.notification.deleteMany({ where: { personId: p.id } });
    await tx.adminFlag.deleteMany({ where: { personId: p.id } });
    // Cascades: Person -> LinkedInAccount, events, incidents, tokens, TOS acceptances, sessions.
    await tx.user.delete({ where: { id: p.userId } });
    await audit({ action: "person.purged", targetType: "person", targetId: p.id }, tx);
  });
}
