import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Parse to E.164 (default region IN). Returns null when invalid. */
export function toE164(input: string): string | null {
  const p = parsePhoneNumberFromString(input.trim(), "IN");
  return p && p.isValid() ? p.number : null;
}

export function digitsOnly(e164: string) {
  return e164.replace(/\D/g, "");
}

export function waJid(e164: string) {
  return `${digitsOnly(e164)}@s.whatsapp.net`;
}
