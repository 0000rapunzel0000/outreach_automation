import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function key(raw?: string) {
  return Buffer.from(raw ?? env().FIELD_ENCRYPTION_KEY, "base64");
}

/** AES-256-GCM, random 12-byte IV per value; returns base64(iv|tag|ciphertext). */
export function encryptField(plain: string, keyB64?: string): string {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALG, key(keyB64), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decryptField(enc: string, keyB64?: string): string {
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const d = createDecipheriv(ALG, key(keyB64), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

export function encryptOptional(v?: string | null) {
  return v ? encryptField(v) : null;
}

export function decryptOptional(v?: string | null) {
  return v ? decryptField(v) : null;
}

/** Mask for display: XXXX1234. */
export function maskTail(v?: string | null, keep = 4) {
  if (!v) return "—";
  return `XXXX${v.slice(-keep)}`;
}

export function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

export function hmac(secret: string, s: string) {
  return createHmac("sha256", secret).update(s).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function randomDigits(n: number) {
  return Array.from({ length: n }, () => randomInt(0, 10)).join("");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
