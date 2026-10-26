import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { STEP } from "@/lib/onboarding/steps";
import { Flash, flashFrom } from "../../../ui";
import { connectLinkedIn } from "../actions";
import { requireApplicantStep } from "../guard";
import { Steps } from "../Steps";

export default async function LinkedInStep({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { person } = await requireApplicantStep(STEP.linkedin);
  const acct = await db.linkedInAccount.findUnique({ where: { personId: person.id } });
  if (acct && person.onboardingStep >= STEP.review) redirect("/apply/review");
  const { error, params, one } = await flashFrom(searchParams);
  const failed = one(params.error) === "1";

  return (
    <>
      <Steps current={STEP.linkedin} />
      <h1>Connect your LinkedIn</h1>
      {failed ? (
        <Flash error="The LinkedIn connection didn't complete. Please try again." />
      ) : (
        <Flash error={error} />
      )}
      {person.linkedinError === "duplicate_linkedin" && (
        <div className="alert error">
          That LinkedIn account is already linked to another person, so we couldn&apos;t use it. Connect your own LinkedIn account.
        </div>
      )}
      <div className="card">
        <p>
          Our outreach runs through your own LinkedIn account. When you connect it, our partner <strong>Unipile</strong> keeps a secure
          session so our system can send connection requests and messages on your behalf, as described in the{" "}
          <Link href="/apply/terms#linkedin">Terms of Service</Link>.
        </p>
        <ul>
          <li>You log in on Unipile&apos;s page, including any two-factor step. We never see your LinkedIn password.</li>
          <li>Keep your LinkedIn connected. If it drops, we&apos;ll message you on WhatsApp with a one-tap reconnect link.</li>
          <li>Use your own account only. Each LinkedIn account can be linked to one person.</li>
        </ul>
        <form action={connectLinkedIn}>
          <button type="submit" className="btn-big">
            Connect LinkedIn
          </button>
        </form>
      </div>
    </>
  );
}
