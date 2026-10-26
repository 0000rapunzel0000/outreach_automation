import "server-only";
import { redirect } from "next/navigation";
import { currentUser, homeFor } from "@/lib/auth";
import { STEP_ROUTES } from "@/lib/onboarding/steps";

/**
 * Server-side step guard (§8): an applicant can't open a step ahead of their
 * onboardingStep, and once submitted only the status page is reachable.
 */
export async function requireApplicantStep(step: number) {
  const user = await currentUser();
  if (!user) redirect("/apply");
  if (user.role !== "APPLICANT" || !user.person) redirect(homeFor(user.role));
  const person = user.person;
  if (person.status !== "DRAFT") redirect("/apply/status");
  if (step > person.onboardingStep) redirect(STEP_ROUTES[person.onboardingStep]);
  return { user, person };
}
