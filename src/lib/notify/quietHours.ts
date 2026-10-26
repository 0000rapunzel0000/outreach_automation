// Quiet hours are evaluated in Asia/Kolkata (UTC+05:30, no DST).
const IST_OFFSET_MIN = 330;
const DAY_MIN = 1440;

function toMin(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * If `at` falls inside quiet hours, return the instant they end; otherwise null.
 * Handles windows that cross midnight (22:00 -> 08:00).
 */
export function quietHoursEnd(at: Date, qh: { start: string; end: string }): Date | null {
  const start = toMin(qh.start);
  const end = toMin(qh.end);
  if (start === end) return null;
  const istMs = at.getTime() + IST_OFFSET_MIN * 60_000;
  const minOfDay = Math.floor(istMs / 60_000) % DAY_MIN;
  const inside = start < end ? minOfDay >= start && minOfDay < end : minOfDay >= start || minOfDay < end;
  if (!inside) return null;
  let wait = end - minOfDay;
  if (wait <= 0) wait += DAY_MIN;
  const startOfMinute = at.getTime() - (at.getTime() % 60_000);
  return new Date(startOfMinute + wait * 60_000);
}
