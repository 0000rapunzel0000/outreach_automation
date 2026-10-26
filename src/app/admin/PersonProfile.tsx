import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { fmtIst } from "@/lib/clock";
import { decryptOptional, maskTail } from "@/lib/crypto";
import { LinkBadge, PersonBadge } from "../ui";

export type ProfilePerson = Prisma.PersonGetPayload<{
  include: { user: true; linkedin: true; tosAcceptances: { include: { tosVersion: true } } };
}>;

/** Profile card shared by the application and employee detail pages. Encrypted fields masked unless `reveal`. */
export function PersonProfile({ p, reveal, canReveal, basePath }: { p: ProfilePerson; reveal: boolean; canReveal: boolean; basePath: string }) {
  const show = (enc: string | null) => {
    const v = decryptOptional(enc);
    return reveal ? (v ?? "—") : maskTail(v);
  };
  const tos = [...p.tosAcceptances].sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime())[0];
  return (
    <div className="grid grid-2">
      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>{p.fullName ?? "(no name yet)"}</h2>
          <PersonBadge status={p.status} />
        </div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Email</dt>
          <dd>{p.user.email}</dd>
          <dt>WhatsApp</dt>
          <dd>
            {p.whatsappE164 ?? "—"}{" "}
            {p.whatsappVerifiedAt ? <span className="muted small">verified {fmtIst(p.whatsappVerifiedAt)}</span> : <span className="badge warn">unverified</span>}
          </dd>
          <dt>Mobile</dt>
          <dd>{p.mobileE164 ?? "—"}</dd>
          <dt>Address</dt>
          <dd>{[p.addressLine1, p.addressLine2, p.city, p.state, p.pincode].filter(Boolean).join(", ") || "—"}</dd>
          <dt>PAN</dt>
          <dd>{show(p.panEnc)}</dd>
          <dt>Payment</dt>
          <dd>
            {p.paymentMethod === "upi"
              ? `UPI ${show(p.upiIdEnc)}`
              : p.paymentMethod === "bank"
                ? `Bank ${show(p.bankAccountEnc)} · IFSC ${show(p.ifscEnc)}`
                : "—"}
          </dd>
        </dl>
        {canReveal && (
          <p style={{ marginTop: 12 }}>
            {reveal ? (
              <Link href={basePath}>Hide sensitive fields</Link>
            ) : (
              <Link href={`${basePath}?reveal=1`}>Reveal PAN and bank details (logged)</Link>
            )}
          </p>
        )}
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>LinkedIn &amp; terms</h2>
        <dl className="kv">
          <dt>LinkedIn</dt>
          <dd>
            {p.linkedin?.profileUrl ? (
              <a href={p.linkedin.profileUrl} target="_blank" rel="noreferrer">
                {p.linkedin.displayName ?? p.linkedin.profileUrl}
              </a>
            ) : (
              (p.linkedin?.displayName ?? "—")
            )}
          </dd>
          <dt>Link status</dt>
          <dd>
            <LinkBadge status={p.linkedin?.status} /> {p.linkedin?.lastStatusAt && <span className="muted small">since {fmtIst(p.linkedin.lastStatusAt)}</span>}
          </dd>
          <dt>Unipile id</dt>
          <dd>
            <code>{p.linkedin?.unipileAccountId ?? "—"}</code>
          </dd>
          <dt>Terms</dt>
          <dd>{tos ? `v${tos.tosVersion.version}, accepted ${fmtIst(tos.acceptedAt)} from ${tos.ip}` : "—"}</dd>
          <dt>Submitted</dt>
          <dd>{fmtIst(p.submittedAt)}</dd>
          {p.activatedAt && (
            <>
              <dt>Active since</dt>
              <dd>{fmtIst(p.activatedAt)}</dd>
            </>
          )}
          {p.rejectionReason && (
            <>
              <dt>Rejection reason</dt>
              <dd>{p.rejectionReason}</dd>
            </>
          )}
        </dl>
        {p.linkedinError === "duplicate_linkedin" && <p className="alert error small" style={{ marginTop: 12 }}>Tried to connect a LinkedIn already linked to someone else.</p>}
      </section>
    </div>
  );
}
