// Structured JSON logger. Never pass secrets; phone numbers go through maskPhone().

type Level = "debug" | "info" | "warn" | "error";

const SECRET_KEYS = /(secret|password|token|api[_-]?key|authorization|code|enc)$/i;

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4 || v == null || typeof v !== "object") return v;
  if (v instanceof Error) return { name: v.name, message: v.message };
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) out[k] = SECRET_KEYS.test(k) ? "[redacted]" : scrub(val, depth + 1);
  return out;
}

function write(level: Level, msg: string, ctx?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level === "debug") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(scrub(ctx) as object) });
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export const log = {
  debug: (m: string, c?: Record<string, unknown>) => write("debug", m, c),
  info: (m: string, c?: Record<string, unknown>) => write("info", m, c),
  warn: (m: string, c?: Record<string, unknown>) => write("warn", m, c),
  error: (m: string, c?: Record<string, unknown>) => write("error", m, c),
};

export function maskPhone(e164?: string | null) {
  if (!e164) return e164;
  return e164.length <= 6 ? "***" : `${e164.slice(0, 3)}******${e164.slice(-3)}`;
}
