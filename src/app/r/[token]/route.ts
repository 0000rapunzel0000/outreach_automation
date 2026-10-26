import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { now } from "@/lib/clock";
import { log } from "@/lib/logger";
import { rateLimit } from "@/lib/ratelimit";
import { findReconnectToken } from "@/lib/monitoring/tokens";
import { startReconnect } from "@/lib/monitoring/reconnect";

/**
 * One-tap reconnect link from WhatsApp (§10). No login: the token is the credential.
 * Reusable until it expires; each use mints a fresh Unipile reconnect link.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const base = env().APP_BASE_URL;
  const page = (state: string) => NextResponse.redirect(`${base}/reconnect?state=${state}`, 302);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await rateLimit(`r:${ip}`, 30, 600))) return page("busy");

  const { token } = await params;
  const t = await findReconnectToken(token);
  if (!t || t.expiresAt < now()) return page("invalid"); // same page for unknown and expired: no info leak

  try {
    const r = await startReconnect(t.personId);
    if (r.kind === "already_connected") return page("connected");
    if (r.kind === "unavailable") return page("invalid");
    await db.reconnectToken.update({ where: { id: t.id }, data: { usedAt: now() } });
    return NextResponse.redirect(r.url, 302);
  } catch (e) {
    log.error("reconnect link failed", { err: e });
    return page("error");
  }
}
