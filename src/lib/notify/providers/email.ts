import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import type { NotifyProvider } from "./types";

// Resend when RESEND_API_KEY is set, else SMTP via Nodemailer (§5.2).
export class EmailProvider implements NotifyProvider {
  channel = "email" as const;
  private transport: nodemailer.Transporter | null = null;

  async isHealthy() {
    return true;
  }

  async send(to: string, body: string, subject = "Outreach team") {
    const e = env();
    if (e.EMAIL_DISABLED) {
      log.info("email disabled; not sent", { to, subject, body });
      return { providerMessageId: "disabled" };
    }
    if (e.RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${e.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: e.EMAIL_FROM, to: [to], subject, text: body }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { id?: string };
      return { providerMessageId: json.id };
    }
    this.transport ??= nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT ?? 587,
      secure: (e.SMTP_PORT ?? 587) === 465,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
    });
    const info = await this.transport.sendMail({ from: e.EMAIL_FROM, to, subject, text: body });
    return { providerMessageId: info.messageId };
  }
}

export const emailProvider = new EmailProvider();
