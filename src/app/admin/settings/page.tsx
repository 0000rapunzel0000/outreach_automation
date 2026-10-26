import QRCode from "qrcode";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtIst, HOUR, now } from "@/lib/clock";
import { getAllSettings, getState, SETTINGS, type SettingKey } from "@/lib/settings";
import { WA_HOURLY_CAP } from "@/lib/notify";
import { Flash, flashFrom } from "../../ui";
import { AutoRefresh } from "../AutoRefresh";
import { saveSettings, sendTest, waCommand } from "../actions";

export const dynamic = "force-dynamic";

const WA_LABEL: Record<string, { text: string; tone: string }> = {
  connected: { text: "Connected", tone: "ok" },
  qr: { text: "Waiting for QR scan", tone: "warn" },
  connecting: { text: "Connecting", tone: "warn" },
  reconnecting: { text: "Reconnecting", tone: "warn" },
  logged_out: { text: "Logged out: re-link needed", tone: "bad" },
  disabled: { text: "Disabled (WA_DISABLED)", tone: "neutral" },
  stopped: { text: "Stopped", tone: "bad" },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireSuperAdmin();
  const { error, ok } = await flashFrom(searchParams);
  const s = await getAllSettings();
  const wa = await getState<{ status: string; at: string }>("wa.status");
  const qr = await getState<{ qr: string; at: string }>("wa.pendingQr");
  const pairing = await getState<{ code: string; phone: string; at: string }>("wa.pendingPairingCode");
  const account = await getState<{ id: string | null; name: string | null }>("wa.account");
  const lastSent = await getState<string>("wa.lastSentAt");
  const sentLastHour = await db.notification.count({ where: { channel: "whatsapp", status: "sent", sentAt: { gte: new Date(now().getTime() - HOUR) } } });
  const qrSvg = qr && wa?.status === "qr" ? await QRCode.toString(qr.qr, { type: "svg", margin: 1, width: 240 }) : null;
  const waState = WA_LABEL[wa?.status ?? ""] ?? { text: wa?.status ?? "Unknown (worker not running?)", tone: "neutral" };
  const recentTests = await db.notification.findMany({ where: { templateKey: "test" }, orderBy: { createdAt: "desc" }, take: 5 });
  const lastRun = await getState<{ at: string; checked: number; changed: number }>("reconciler.lastRun");
  const lastErr = await getState<{ at: string; message: string }>("reconciler.lastError");

  const numberKeys = (Object.keys(SETTINGS) as SettingKey[]).filter((k) => typeof SETTINGS[k].default === "number");

  return (
    <>
      {(wa?.status === "qr" || wa?.status === "connecting" || wa?.status === "reconnecting") && <AutoRefresh seconds={5} />}
      <h1>Settings</h1>
      <Flash error={error} ok={ok} />

      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>WhatsApp sender</h2>
          <span className={`badge ${waState.tone}`}>{waState.text}</span>
        </div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Linked number</dt>
          <dd>{account?.id ? account.id.split(":")[0].split("@")[0] : "—"}</dd>
          <dt>Status since</dt>
          <dd>{wa?.at ? fmtIst(new Date(wa.at)) : "—"}</dd>
          <dt>Last sent</dt>
          <dd>{lastSent ? fmtIst(new Date(lastSent)) : "—"}</dd>
          <dt>Sent in the last hour</dt>
          <dd>
            {sentLastHour} / {WA_HOURLY_CAP}
          </dd>
        </dl>
        {qrSvg && (
          <div style={{ marginTop: 16 }}>
            <p>On the sender phone: WhatsApp → Linked devices → Link a device, then scan:</p>
            <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            {pairing && (
              <p style={{ marginTop: 12 }}>
                Or use &quot;Link with phone number&quot; and enter <strong style={{ fontSize: "1.2rem", letterSpacing: 2 }}>{pairing.code}</strong>
              </p>
            )}
          </div>
        )}
        <div className="row" style={{ marginTop: 16, alignItems: "flex-end" }}>
          <form action={waCommand} className="row" style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="cmd" value="relink" />
            <div>
              <label htmlFor="pairingPhone">Sender number, for a pairing code instead of QR (optional)</label>
              <input id="pairingPhone" name="pairingPhone" type="tel" placeholder="+91 98765 43210" />
            </div>
            <button type="submit">Re-link</button>
          </form>
          <form action={waCommand}>
            <input type="hidden" name="cmd" value="logout" />
            <button type="submit" className="secondary">
              Log out
            </button>
          </form>
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>
          Use a dedicated SIM. Messages go out one at a time with a 5–15 s gap, at most {WA_HOURLY_CAP} an hour. If WhatsApp is down, messages fall back to email.
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Send a test message</h2>
        <form action={sendTest} className="row" style={{ alignItems: "flex-end" }}>
          <div>
            <label htmlFor="tw">WhatsApp number</label>
            <input id="tw" name="whatsapp" type="tel" />
          </div>
          <div>
            <label htmlFor="te">Email</label>
            <input id="te" name="email" type="email" />
          </div>
          <button type="submit">Send test</button>
        </form>
        {recentTests.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <tbody>
              {recentTests.map((n) => (
                <tr key={n.id}>
                  <td>{fmtIst(n.createdAt)}</td>
                  <td>{n.channel}</td>
                  <td>{n.toAddress}</td>
                  <td>
                    <span className={`badge ${n.status === "sent" ? "ok" : n.status === "failed" ? "bad" : "warn"}`}>{n.status}</span>
                  </td>
                  <td className="small muted">{n.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <form action={saveSettings} className="card">
        <h2 style={{ marginTop: 0 }}>Nudges and monitoring</h2>
        <div className="grid grid-2">
          {numberKeys.map((k) => (
            <div key={k}>
              <label htmlFor={k}>{SETTINGS[k].label}</label>
              <input id={k} name={k} type="number" defaultValue={String(s[k])} required />
            </div>
          ))}
          <div>
            <label htmlFor="qs">Quiet hours start (IST)</label>
            <input id="qs" name="quietHours.start" defaultValue={s.quietHours.start} pattern="\d{2}:\d{2}" required />
          </div>
          <div>
            <label htmlFor="qe">Quiet hours end (IST)</label>
            <input id="qe" name="quietHours.end" defaultValue={s.quietHours.end} pattern="\d{2}:\d{2}" required />
          </div>
        </div>
        <label className="check" style={{ marginTop: 16 }}>
          <input type="checkbox" name="nudge.dailyReminderAfterEscalation" defaultChecked={s["nudge.dailyReminderAfterEscalation"]} />
          <span>{SETTINGS["nudge.dailyReminderAfterEscalation"].label}</span>
        </label>
        <p style={{ marginTop: 16 }}>
          <button type="submit">Save settings</button>
        </p>
      </form>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Reconciler</h2>
        <p>
          Last run: {lastRun ? `${fmtIst(new Date(lastRun.at))}, ${lastRun.checked} accounts checked, ${lastRun.changed} changed` : "never"}
        </p>
        {lastErr && <p className="muted small">Last error {fmtIst(new Date(lastErr.at))}: {lastErr.message}</p>}
      </section>
    </>
  );
}
