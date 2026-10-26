export interface NotifyProvider {
  channel: "whatsapp" | "email";
  isHealthy(): Promise<boolean>;
  send(to: string, body: string, subject?: string): Promise<{ providerMessageId?: string }>;
}

export interface WhatsAppProvider extends NotifyProvider {
  channel: "whatsapp";
  onWhatsApp(e164: string): Promise<boolean>;
}
