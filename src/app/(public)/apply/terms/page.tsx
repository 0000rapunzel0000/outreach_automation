import { STEP } from "@/lib/onboarding/steps";
import { currentTos, renderTos } from "@/lib/tos";
import { Flash, flashFrom } from "../../../ui";
import { AgreeForm } from "../../../AgreeForm";
import { acceptTerms } from "../actions";
import { requireApplicantStep } from "../guard";
import { Steps } from "../Steps";

export default async function TermsStep({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireApplicantStep(STEP.terms);
  const tos = await currentTos();
  const { error } = await flashFrom(searchParams);
  return (
    <>
      <Steps current={STEP.terms} />
      <h1>Terms of Service</h1>
      <Flash error={error} />
      {!tos ? (
        <div className="alert warn">The Terms of Service haven&apos;t been published yet. Please check back soon.</div>
      ) : (
        <div className="card">
          <div className="tos" dangerouslySetInnerHTML={{ __html: renderTos(tos.contentMd) }} />
          <AgreeForm action={acceptTerms} tosVersionId={tos.id} version={tos.version} buttonLabel="Agree and continue" />
        </div>
      )}
    </>
  );
}
