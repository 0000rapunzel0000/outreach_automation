import { db } from "@/lib/db";
import { env, isProd } from "@/lib/env";
import { HOUR, MIN, now } from "@/lib/clock";
import { log, maskPhone } from "@/lib/logger";
import { randomDigits, safeEqual, sha256 } from "@/lib/crypto";
import { notify } from "@/lib/notify";
import { workerRpc } from "@/lib/workerRpc";

const PURPOSE = "whatsapp_verify";
const TTL = 10 * MIN;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 3;

export class OtpError extends Error {}

function hashCode(code: string) {
  return sha256(code + (env().OTP_PEPPER ?? env().RECONNECT_TOKEN_SECRET));
}

/** Check the number is on WhatsApp (cached on Person), then send a 6-digit code over WhatsApp only. */
export async function sendWhatsAppOtp(personId: string, phoneE164: string): Promise<{ devCode?: string }> {
  const since = new Date(now().getTime() - HOUR);
  const sends = await db.otpCode.count({ where: { phoneE164, purpose: PURPOSE, createdAt: { gte: since } } });
  if (sends >= MAX_SENDS_PER_HOUR) throw new OtpError("Too many codes sent to this number. Try again in an hour.");

  const person = await db.person.findUniqueOrThrow({ where: { id: personId } });
  if (!env().WA_DISABLED) {
    let onWa = person.whatsappE164 === phoneE164 ? person.whatsappOnWa : null;
    if (onWa == null) {
      const r = await workerRpc<{ exists: boolean }>("wa.onWhatsApp", { phone: phoneE164 });
      onWa = r.exists;
    }
    await db.person.update({ where: { id: personId }, data: { whatsappOnWa: onWa, whatsappOnWaCheckedAt: now() } });
    if (!onWa) throw new OtpError("This number isn't on WhatsApp. Please use a WhatsApp number.");
  }

  const code = randomDigits(6);
  await db.otpCode.create({ data: { phoneE164, purpose: PURPOSE, codeHash: hashCode(code), expiresAt: new Date(now().getTime() + TTL) } });
  await notify(personId, "otp", { code }, { channels: ["whatsapp"], to: { whatsapp: phoneE164 }, bypassQuietHours: true, priority: 10 });
  log.info("otp sent", { personId, phone: maskPhone(phoneE164) });

  // Dev convenience: with WhatsApp disabled the code would be unreachable, so show it on the page.
  return env().WA_DISABLED && !isProd() ? { devCode: code } : {};
}

export async function verifyWhatsAppOtp(personId: string, phoneE164: string, code: string) {
  const otp = await db.otpCode.findFirst({
    where: { phoneE164, purpose: PURPOSE, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.expiresAt < now()) throw new OtpError("The code has expired. Send a new one.");
  if (otp.attempts >= MAX_ATTEMPTS) throw new OtpError("Too many wrong attempts. Send a new code.");
  await db.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
  if (!safeEqual(hashCode(code.trim()), otp.codeHash)) throw new OtpError("That code isn't right.");
  await db.otpCode.update({ where: { id: otp.id }, data: { consumedAt: now() } });
  await db.person.update({ where: { id: personId }, data: { whatsappE164: phoneE164, whatsappVerifiedAt: now(), whatsappOnWa: true } });
}
