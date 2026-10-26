import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HOUR, now } from "@/lib/clock";
import { getSetting } from "@/lib/settings";
import { hmac, randomToken } from "@/lib/crypto";

// The URL carries a 256-bit random token; the DB stores only its HMAC, so a DB leak gives no usable links.
export function tokenId(token: string) {
  return hmac(env().RECONNECT_TOKEN_SECRET, token);
}

export async function mintReconnectLink(personId: string, incidentId?: string | null) {
  const ttlHours = await getSetting("reconnectToken.ttlHours");
  const token = randomToken(32);
  await db.reconnectToken.create({
    data: { id: tokenId(token), personId, incidentId: incidentId ?? null, expiresAt: new Date(now().getTime() + ttlHours * HOUR) },
  });
  return `${env().APP_BASE_URL}/r/${token}`;
}

export async function findReconnectToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return db.reconnectToken.findUnique({ where: { id: tokenId(token) } });
}
