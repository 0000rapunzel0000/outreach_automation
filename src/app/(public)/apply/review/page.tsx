import { db } from "@/lib/db";
import { decryptOptional, maskTail } from "@/lib/crypto";
import { fmtIst } from "@/lib/clock";
import { STEP } from "@/lib/onboarding/steps";
import { Flash, flashFrom, LinkBadge } from "../../../ui";
import { submitApplication } from "../actions";
import { requireApplicantStep } from "../guard";
import { Steps } from "../Steps";

export default async function ReviewStep({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { person } = await requireApplicantStep(STEP.review);
  const p = await db.person.findUniqueOrThrow({
    where: { id: person.id },
    include: { linkedin: true, tosAcceptances: { include: { tosVersion: true }, orderBy: { acceptedAt: "desc" }, take: 1 } },
  });
  const tos = p.tosAcceptances[0];
  const { error } = await flashFrom(searchParams);

  return (
    <>
      <Steps current={STEP.review} />
      <h1>Check and submit</h1>
      <Flash error={error} />
      <div className="card">
        <dl className="kv">
          <dt>Name</dt>
          <dd>{p.fullName}</dd>
          <dt>WhatsApp</dt>
          <dd>
            {p.whatsappE164} <span className="badge ok">verified</span>
          </dd>
          <dt>Mobile</dt>
          <dd>{p.mobileE164}</dd>
          <dt>Address</dt>
          <dd>
            {[p.addressLine1, p.addressLine2, p.city, p.state, p.pincode].filter(Boolean).join(", ")}
          </dd>
          <dt>PAN</dt>
          <dd>{maskTail(decryptOptional(p.panEnc))}</dd>
          <dt>Payment</dt>
          <dd>{p.paymentMethod === "upi" ? `UPI ${maskTail(decryptOptional(p.upiIdEnc))}` : `Bank ${maskTail(decryptOptional(p.bankAccountEnc))}`}</dd>
          <dt>LinkedIn</dt>
          <dd>
            {p.linkedin?.profileUrl ? <a href={p.linkedin.profileUrl}>{p.linkedin.displayName ?? p.linkedin.profileUrl}</a> : p.linkedin?.displayName}{" "}
            <LinkBadge status={p.linkedin?.status} />
          </dd>
          <dt>Terms</dt>
          <dd>{tos ? `v${tos.tosVersion.version}, accepted ${fmtIst(tos.acceptedAt)}` : "—"}</dd>
        </dl>
        <p className="muted small" style={{ marginTop: 16 }}>
          Need to change something? Go back to <a href="/apply/details">your details</a>.
        </p>
        <form action={submitApplication}>
          <button type="submit">Submit application</button>
        </form>
      </div>
    </>
  );
}
