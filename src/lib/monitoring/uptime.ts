import { db } from "@/lib/db";
import { now } from "@/lib/clock";

const IST_OFFSET_MS = 330 * 60_000;

/** Payroll month boundaries in IST, as UTC instants. month is 1-12. */
export function istMonthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1) - IST_OFFSET_MS);
  const end = new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS);
  return { start, end };
}

export function currentIstMonth(at = now()) {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
}

export function previousIstMonth(at = now()) {
  const { year, month } = currentIstMonth(at);
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/**
 * Uptime for payroll (§6). Exposed only; pay logic is unchanged (D2).
 * Active window = [max(month start, activatedAt), min(month end, now, offboardedAt)].
 * Suspended spans aren't tracked as history, so they count as active time.
 */
export async function monthlyUptime(personId: string, year: number, month: number) {
  const person = await db.person.findUnique({ where: { id: personId } });
  const { start, end } = istMonthRange(year, month);
  const zero = { activeSeconds: 0, downSeconds: 0, uptimePct: null as number | null };
  if (!person?.activatedAt) return zero;

  const winStart = Math.max(start.getTime(), person.activatedAt.getTime());
  const winEnd = Math.min(end.getTime(), now().getTime(), person.offboardedAt?.getTime() ?? Infinity);
  if (winEnd <= winStart) return zero;

  const incidents = await db.incident.findMany({
    where: { personId, startedAt: { lt: new Date(winEnd) }, OR: [{ resolvedAt: null }, { resolvedAt: { gt: new Date(winStart) } }] },
    orderBy: { startedAt: "asc" },
  });

  // Merge overlaps defensively, then clip to the window.
  let down = 0;
  let curS = -1;
  let curE = -1;
  for (const i of incidents) {
    const s = Math.max(i.startedAt.getTime(), winStart);
    const e = Math.min(i.resolvedAt?.getTime() ?? now().getTime(), winEnd);
    if (e <= s) continue;
    if (s > curE) {
      if (curE > curS) down += curE - curS;
      curS = s;
      curE = e;
    } else curE = Math.max(curE, e);
  }
  if (curE > curS) down += curE - curS;

  const activeSeconds = Math.round((winEnd - winStart) / 1000);
  const downSeconds = Math.round(down / 1000);
  return { activeSeconds, downSeconds, uptimePct: activeSeconds ? Math.round(((activeSeconds - downSeconds) / activeSeconds) * 10000) / 100 : null };
}
