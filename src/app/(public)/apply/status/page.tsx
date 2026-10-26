import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser, homeFor } from "@/lib/auth";
import { fmtIst } from "@/lib/clock";
import { STEP_ROUTES } from "@/lib/onboarding/steps";
import { LinkBadge } from "../../../ui";
import { reconnectPending } from "../actions";

export default async function ApplicationStatus() {
  const user = await currentUser();
  if (!user?.person) redirect("/login");
  if (user.role !== "APPLICANT") redirect(homeFor(user.role));
  const p = await db.person.findUniqueOrThrow({ where: { id: user.person.id }, include: { linkedin: true } });
  if (p.status === "DRAFT") redirect(STEP_ROUTES[p.onboardingStep]);

  if (p.status === "REJECTED") {
    // D6: the reason is internal.
    return (
      <>
        <h1>Application update</h1>
        <div className="card">
          <p>Thanks for applying. We&apos;re not moving forward right now.</p>
        </div>
      </>
    );
  }

  const dropped = p.linkedin && p.linkedin.status !== "CONNECTED" && p.linkedin.status !== "CONNECTING";
  return (
    <>
      <h1>Application submitted</h1>
      <div className="card">
        <p>
          <span className="badge warn">Pending review</span> Submitted {fmtIst(p.submittedAt)}.
        </p>
        <p>An admin will review your application. We&apos;ll message you on WhatsApp once it&apos;s decided.</p>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>LinkedIn</h2>
        <p>
          {p.linkedin?.displayName} <LinkBadge status={p.linkedin?.status} />
        </p>
        {dropped && (
          <>
            <p className="alert warn">Your LinkedIn got disconnected. Please reconnect it so your application can go ahead.</p>
            <form action={reconnectPending}>
              <button type="submit" className="btn-big">
                Reconnect LinkedIn
              </button>
            </form>
          </>
        )}
      </div>
    </>
  );
}
