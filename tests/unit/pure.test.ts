import { describe, expect, it } from "vitest";
import { decryptField, encryptField, maskTail } from "@/lib/crypto";
import { normalize } from "@/lib/monitoring/normalize";
import { quietHoursEnd } from "@/lib/notify/quietHours";
import { render } from "@/lib/notify/templates";
import { toE164, waJid } from "@/lib/phone";
import { istMonthRange } from "@/lib/monitoring/uptime";

describe("field encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptField("ABCDE1234F");
    const b = encryptField("ABCDE1234F");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("ABCDE1234F");
    expect(Buffer.from(a, "base64").length).toBe(12 + 16 + 10);
  });

  it("rejects tampered ciphertext", () => {
    const buf = Buffer.from(encryptField("secret"), "base64");
    buf[buf.length - 1] ^= 1;
    expect(() => decryptField(buf.toString("base64"))).toThrow();
  });

  it("rejects the wrong key", () => {
    const enc = encryptField("secret");
    expect(() => decryptField(enc, Buffer.alloc(32, 9).toString("base64"))).toThrow();
  });

  it("masks to the last 4", () => {
    expect(maskTail("123456789012")).toBe("XXXX9012");
    expect(maskTail(null)).toBe("—");
  });
});

describe("normalize", () => {
  it.each([
    ["OK", "CONNECTED"],
    ["CREATION_SUCCESS", "CONNECTED"],
    ["RECONNECTED", "CONNECTED"],
    ["SYNC_SUCCESS", "CONNECTED"],
    ["CONNECTING", "CONNECTING"],
    ["CREDENTIALS", "NEEDS_RECONNECT"],
    ["STOPPED", "NEEDS_RECONNECT"],
    ["ERROR", "TRANSIENT_ERROR"],
    ["DELETED", "DELETED"],
    ["SOMETHING_NEW", "TRANSIENT_ERROR"],
  ])("%s -> %s", (raw, out) => expect(normalize(raw)).toBe(out));
});

describe("quiet hours (IST, 22:00-08:00)", () => {
  const qh = { start: "22:00", end: "08:00" };
  it("is open at noon IST", () => expect(quietHoursEnd(new Date("2026-03-10T06:30:00Z"), qh)).toBeNull());
  it("defers 22:30 IST to 08:00 IST next day", () =>
    expect(quietHoursEnd(new Date("2026-03-10T17:00:00Z"), qh)?.toISOString()).toBe("2026-03-11T02:30:00.000Z"));
  it("defers 03:00 IST to 08:00 IST same day", () =>
    expect(quietHoursEnd(new Date("2026-03-10T21:30:00Z"), qh)?.toISOString()).toBe("2026-03-11T02:30:00.000Z"));
  it("08:00 IST exactly is open", () => expect(quietHoursEnd(new Date("2026-03-11T02:30:00Z"), qh)).toBeNull());
  it("supports same-day windows", () =>
    expect(quietHoursEnd(new Date("2026-03-10T08:30:00Z"), { start: "13:00", end: "15:00" })?.toISOString()).toBe("2026-03-10T09:30:00.000Z"));
});

describe("misc", () => {
  it("parses Indian numbers to E.164", () => {
    expect(toE164("98765 43210")).toBe("+919876543210");
    expect(toE164("+91 98765-43210")).toBe("+919876543210");
    expect(toE164("12345")).toBeNull();
    expect(waJid("+919876543210")).toBe("919876543210@s.whatsapp.net");
  });
  it("renders templates", () => {
    expect(render("nudge_1", { firstName: "Asha", link: "https://x/r/abc" })).toContain("Hi Asha");
  });
  it("IST month boundaries", () => {
    const { start, end } = istMonthRange(2026, 3);
    expect(start.toISOString()).toBe("2026-02-28T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-03-31T18:30:00.000Z");
  });
});
