import type { WhatsAppProvider } from "./types";

/**
 * Future: WhatsApp Business Cloud API (§5.3, D7).
 * Needs: a Meta Business account, WHATSAPP_PHONE_NUMBER_ID, a permanent access token,
 * and an approved template per TemplateKey (business-initiated messages must use templates;
 * OTPs use an "authentication" template). Register it in the worker in place of Baileys.
 */
export class CloudApiProvider implements WhatsAppProvider {
  channel = "whatsapp" as const;
  async isHealthy(): Promise<boolean> {
    throw new Error("CloudApiProvider not implemented");
  }
  async send(): Promise<{ providerMessageId?: string }> {
    throw new Error("CloudApiProvider not implemented");
  }
  async onWhatsApp(): Promise<boolean> {
    throw new Error("CloudApiProvider not implemented");
  }
}
