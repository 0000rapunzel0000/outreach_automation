import { db } from "@/lib/db";
import { now } from "@/lib/clock";

/**
 * Fixed-window limiter backed by Postgres (shared by every web instance).
 * Returns true when the call is allowed.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const t = now();
  const windowStart = new Date(Math.floor(t.getTime() / (windowSec * 1000)) * windowSec * 1000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" = ${windowStart} THEN "RateLimit"."count" + 1 ELSE 1 END,
      "windowStart" = ${windowStart}
    RETURNING "count"`;
  return (rows[0]?.count ?? 1) <= limit;
}

export class RateLimitedError extends Error {
  constructor() {
    super("Too many attempts. Please wait and try again.");
  }
}

export async function enforceRateLimit(key: string, limit: number, windowSec: number) {
  if (!(await rateLimit(key, limit, windowSec))) throw new RateLimitedError();
}
