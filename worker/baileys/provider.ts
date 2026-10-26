import makeWASocket, { DisconnectReason, type WASocket } from "baileys";
import type { Boom } from "@hapi/boom";
import pino from "pino";
import { Mutex } from "async-mutex";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { now } from "@/lib/clock";
import { log, maskPhone } from "@/lib/logger";
import { clearState, setState } from "@/lib/settings";
import { waJid } from "@/lib/phone";
import { notifyAdmins } from "@/lib/notify";
import type { WhatsAppProvider } from "@/lib/notify/providers/types";
import { clearDbAuthState, useDbAuthState } from "./authState";

export type WaStatus = "connecting" | "qr" | "connected" | "reconnecting" | "logged_out" | "stopped";

const MIN_GAP_MS = 5_000;
const MAX_GAP_MS = 15_000;

/** Baileys-backed WhatsApp sender (§5.1). Runs only in the worker; exactly one per process. */
export class BaileysProvider implements WhatsAppProvider {
  channel = "whatsapp" as const;
  private sock: WASocket | null = null;
  private status: WaStatus = "stopped";
  private backoffMs = 1_000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private sendLock = new Mutex();
  private lastSendAt = 0;
  private onWaCache = new Map<string, boolean>();
  private stopping = false;
  private pairingPhone: string | null = null;

  async isHealthy() {
    return this.status === "connected";
  }

  getStatus() {
    return this.status;
  }

  private async setStatus(s: WaStatus) {
    this.status = s;
    await setState("wa.status", { status: s, at: now().toISOString() });
  }

  async start() {
    this.stopping = false;
    await this.setStatus(this.status === "reconnecting" ? "reconnecting" : "connecting");
    const { state, saveCreds } = await useDbAuthState();
    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: "warn" }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.sock = sock;
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u) => {
      try {
        if (u.qr) {
          if (this.pairingPhone && !state.creds.registered) {
            const phone = this.pairingPhone;
            this.pairingPhone = null;
            const code = await sock.requestPairingCode(phone.replace(/\D/g, ""));
            await setState("wa.pendingPairingCode", { code, phone: maskPhone(phone) ?? "", at: now().toISOString() });
          }
          await setState("wa.pendingQr", { qr: u.qr, at: now().toISOString() });
          await this.setStatus("qr");
        }
        if (u.connection === "open") {
          this.backoffMs = 1_000;
          await clearState("wa.pendingQr");
          await clearState("wa.pendingPairingCode");
          await setState("wa.account", { id: sock.user?.id ?? null, name: sock.user?.name ?? null });
          await this.setStatus("connected");
          log.info("whatsapp connected");
        }
        if (u.connection === "close") {
          if (this.sock !== sock) return; // an old socket we already replaced
          const code = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            log.warn("whatsapp logged out");
            this.sock = null;
            await clearDbAuthState();
            await clearState("wa.pendingQr");
            await this.setStatus("logged_out");
            await notifyAdmins("admin_wa_down", { settingsLink: `${env().APP_BASE_URL}/admin/settings` }, { channels: ["email"] });
            return;
          }
          if (this.stopping) return;
          await this.setStatus("reconnecting");
          const delay = code === DisconnectReason.restartRequired ? 0 : this.backoffMs;
          this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
          log.warn("whatsapp closed; reconnecting", { code, delay });
          this.reconnectTimer = setTimeout(() => this.start().catch((e) => log.error("whatsapp restart failed", { err: e })), delay);
        }
      } catch (e) {
        log.error("connection.update handler failed", { err: e });
      }
    });
  }

  /** Detach the socket first so its close event is ignored (no "logged out" alert for our own actions). */
  private async teardown(logout: boolean) {
    const s = this.sock;
    this.sock = null;
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (logout) {
      try {
        await s?.logout();
      } catch {}
    }
    s?.end(undefined);
  }

  async stop() {
    await this.teardown(false);
  }

  /** Admin "Re-link": drop the session and start fresh so a new QR (or pairing code) appears. */
  async relink(pairingPhone?: string) {
    await this.teardown(true);
    await clearDbAuthState();
    await clearState("wa.pendingPairingCode");
    this.pairingPhone = pairingPhone ?? null;
    this.backoffMs = 1_000;
    await this.start();
  }

  async logout() {
    await this.teardown(true);
    await clearDbAuthState();
    await clearState("wa.pendingQr");
    await this.setStatus("logged_out");
  }

  async onWhatsApp(e164: string) {
    if (this.onWaCache.has(e164)) return this.onWaCache.get(e164)!;
    if (!this.sock || this.status !== "connected") throw new Error("WhatsApp sender is not connected");
    const res = await this.sock.onWhatsApp(waJid(e164));
    const exists = !!res?.[0]?.exists;
    this.onWaCache.set(e164, exists);
    await db.person.updateMany({ where: { whatsappE164: e164 }, data: { whatsappOnWa: exists, whatsappOnWaCheckedAt: now() } });
    return exists;
  }

  /** One message at a time with a random 5–15 s gap; the hourly cap is enforced by deliverNotification. */
  async send(to: string, body: string) {
    return this.sendLock.runExclusive(async () => {
      const gap = MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
      const wait = this.lastSendAt + gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (!this.sock || this.status !== "connected") throw new Error("WhatsApp sender is not connected");
      if (!(await this.onWhatsApp(to))) throw new Error("Number is not on WhatsApp");
      const msg = await this.sock.sendMessage(waJid(to), { text: body });
      this.lastSendAt = Date.now();
      await setState("wa.lastSentAt", now().toISOString());
      log.info("whatsapp sent", { to: maskPhone(to) });
      return { providerMessageId: msg?.key?.id ?? undefined };
    });
  }
}
