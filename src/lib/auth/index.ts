import "server-only";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { DAY, now } from "@/lib/clock";

const COOKIE = "op_session";
const SESSION_TTL = 14 * DAY;

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(now().getTime() + SESSION_TTL);
  await db.session.create({ data: { id: sha256(token), userId, expiresAt } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: sha256(token) } });
  jar.delete(COOKIE);
}

export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({ where: { id: sha256(token) }, include: { user: { include: { person: true } } } });
  if (!s || s.expiresAt < now()) return null;
  return s.user;
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

export const ADMIN_ROLES: Role[] = ["REVIEWER", "SUPER_ADMIN"];

export function homeFor(role: Role) {
  if (role === "SUPER_ADMIN" || role === "REVIEWER") return "/admin/team";
  if (role === "EMPLOYEE") return "/portal";
  return "/apply";
}

/**
 * Shared RBAC check for every server action, page and route handler (§13).
 * Not logged in -> /login. Wrong role -> /forbidden.
 */
export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (roles.length && !roles.includes(user.role)) redirect("/forbidden");
  return user;
}

export const requireAdmin = () => requireRole("REVIEWER", "SUPER_ADMIN");
export const requireSuperAdmin = () => requireRole("SUPER_ADMIN");

/** First hop of x-forwarded-for, else x-real-ip. */
export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function userAgent() {
  return (await headers()).get("user-agent") ?? "unknown";
}
