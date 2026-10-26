import { cookies } from "next/headers";
import { isProd } from "@/lib/env";
import { STEP } from "@/lib/onboarding/steps";
import { Flash, flashFrom } from "../../../ui";
import { saveDetails, sendOtp, verifyOtp } from "../actions";
import { requireApplicantStep } from "../guard";
import { Steps } from "../Steps";

export default async function DetailsStep({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { person } = await requireApplicantStep(STEP.details);
  const { error, ok, params, one } = await flashFrom(searchParams);
  const otpTo = one(params.otpTo);
  const devCode = isProd() ? null : ((await cookies()).get("dev_otp")?.value ?? null);
  const verified = !!person.whatsappVerifiedAt && !!person.whatsappE164;

  return (
    <>
      <Steps current={STEP.details} />
      <h1>Your details</h1>
      <Flash error={error} ok={ok} />

      <section className="card">
        <h2 style={{ marginTop: 0 }}>1. Verify your WhatsApp number</h2>
        <p className="muted small">
          We send reconnect reminders on WhatsApp, so we need to be sure we can reach you there.
        </p>
        {verified && !otpTo ? (
          <p>
            <span className="badge ok">Verified</span> {person.whatsappE164}{" "}
            <span className="muted small">(to use a different number, send a code to it below)</span>
          </p>
        ) : null}
        <form action={sendOtp} className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="whatsapp">WhatsApp number</label>
            <input id="whatsapp" name="whatsapp" type="tel" placeholder="+91 98765 43210" defaultValue={otpTo ?? person.whatsappE164 ?? ""} required />
          </div>
          <button type="submit" className="secondary">
            Send code
          </button>
        </form>
        {otpTo && (
          <form action={verifyOtp} className="row" style={{ alignItems: "flex-end", marginTop: 8 }}>
            <input type="hidden" name="whatsapp" value={otpTo} />
            <div style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="code">6-digit code sent to {otpTo}</label>
              <input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required />
            </div>
            <button type="submit">Verify</button>
          </form>
        )}
        {devCode && <p className="alert warn small" style={{ marginTop: 12 }}>Dev mode (WA_DISABLED): your code is {devCode}</p>}
      </section>

      <form action={saveDetails} className="card">
        <h2 style={{ marginTop: 0 }}>2. Personal and payment details</h2>
        {!verified && <p className="alert warn small">Verify your WhatsApp number above before continuing.</p>}
        <fieldset disabled={!verified} style={{ border: 0, padding: 0, margin: 0 }}>
          <label htmlFor="fullName">Full name (as on PAN)</label>
          <input id="fullName" name="fullName" defaultValue={person.fullName ?? ""} required />

          <label className="check" style={{ marginTop: 14 }}>
            <input type="checkbox" name="sameAsWhatsapp" defaultChecked={!person.mobileE164 || person.mobileE164 === person.whatsappE164} />
            <span>My mobile number is the same as my WhatsApp number</span>
          </label>
          <label htmlFor="mobile">Mobile number (if different)</label>
          <input id="mobile" name="mobile" type="tel" defaultValue={person.mobileE164 !== person.whatsappE164 ? (person.mobileE164 ?? "") : ""} />

          <label htmlFor="addressLine1">Address line 1</label>
          <input id="addressLine1" name="addressLine1" defaultValue={person.addressLine1 ?? ""} required />
          <label htmlFor="addressLine2">Address line 2 (optional)</label>
          <input id="addressLine2" name="addressLine2" defaultValue={person.addressLine2 ?? ""} />
          <div className="grid grid-2">
            <div>
              <label htmlFor="city">City</label>
              <input id="city" name="city" defaultValue={person.city ?? ""} required />
            </div>
            <div>
              <label htmlFor="state">State</label>
              <input id="state" name="state" defaultValue={person.state ?? ""} required />
            </div>
          </div>
          <label htmlFor="pincode">PIN code</label>
          <input id="pincode" name="pincode" inputMode="numeric" maxLength={6} defaultValue={person.pincode ?? ""} required />

          <label htmlFor="pan">PAN</label>
          <input id="pan" name="pan" autoCapitalize="characters" maxLength={10} placeholder="ABCDE1234F" required />
          <p className="muted small">PAN and bank details are encrypted and only visible to senior admins.</p>

          <label>How should we pay you?</label>
          <label className="check">
            <input type="radio" name="paymentMethod" value="bank" defaultChecked={person.paymentMethod !== "upi"} /> <span>Bank transfer</span>
          </label>
          <div className="grid grid-2">
            <div>
              <label htmlFor="bankAccount">Bank account number</label>
              <input id="bankAccount" name="bankAccount" inputMode="numeric" />
            </div>
            <div>
              <label htmlFor="ifsc">IFSC</label>
              <input id="ifsc" name="ifsc" autoCapitalize="characters" maxLength={11} />
            </div>
          </div>
          <label className="check" style={{ marginTop: 12 }}>
            <input type="radio" name="paymentMethod" value="upi" defaultChecked={person.paymentMethod === "upi"} /> <span>UPI</span>
          </label>
          <label htmlFor="upiId">UPI ID</label>
          <input id="upiId" name="upiId" placeholder="name@okbank" />

          <p style={{ marginTop: 20 }}>
            <button type="submit">Save and continue</button>
          </p>
        </fieldset>
      </form>
    </>
  );
}
