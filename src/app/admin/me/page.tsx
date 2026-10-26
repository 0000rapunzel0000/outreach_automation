import { requireAdmin } from "@/lib/auth";
import { Flash, flashFrom } from "../../ui";
import { saveMyWhatsApp } from "../actions";

export default async function MyAlerts({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireAdmin();
  const { error, ok } = await flashFrom(searchParams);
  return (
    <>
      <h1>My alerts</h1>
      <Flash error={error} ok={ok} />
      <form action={saveMyWhatsApp} className="card narrow">
        <p>Escalations (someone disconnected for 24 hours) go to every admin on WhatsApp, with email as a fallback. Other admin alerts go by email to {user.email}.</p>
        <label htmlFor="whatsapp">My WhatsApp number (leave empty for email only)</label>
        <input id="whatsapp" name="whatsapp" type="tel" defaultValue={user.whatsappE164 ?? ""} placeholder="+91 98765 43210" />
        <p style={{ marginTop: 12 }}>
          <button type="submit">Save</button>
        </p>
      </form>
    </>
  );
}
