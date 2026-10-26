// Injectable clock so tests can time-travel (§12). Production code calls now().

let override: Date | null = null;

export function now(): Date {
  return override ? new Date(override) : new Date();
}

export const clock = {
  set(d: Date) {
    override = new Date(d);
  },
  advance(ms: number) {
    override = new Date(now().getTime() + ms);
  },
  reset() {
    override = null;
  },
};

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const DISPLAY_TZ = "Asia/Kolkata";

export function fmtIst(d?: Date | null) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: DISPLAY_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function fmtDuration(ms: number) {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
