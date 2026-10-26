import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, homeFor } from "@/lib/auth";
import { STEP_ROUTES } from "@/lib/onboarding/steps";
import { Flash, flashFrom } from "../../ui";
import { signup } from "./actions";
import { Steps } from "./Steps";

export default async function ApplyStart({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await currentUser();
  if (user) {
    if (user.role !== "APPLICANT" || !user.person) redirect(homeFor(user.role));
    redirect(user.person.status === "DRAFT" ? STEP_ROUTES[user.person.onboardingStep] : "/apply/status");
  }
  const { error } = await flashFrom(searchParams);
  return (
    <>
      <Steps current={0} />
      <h1>Apply to join the outreach team</h1>
      <p className="muted">
        It takes about 10 minutes. You&apos;ll accept our Terms, share your details, verify your WhatsApp number and connect your LinkedIn.
      </p>
      <Flash error={error} />
      <form action={signup} className="card">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="password">Password (at least 10 characters)</label>
        <input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required />
        <label htmlFor="confirm">Confirm password</label>
        <input id="confirm" name="confirm" type="password" minLength={10} autoComplete="new-password" required />
        <p style={{ marginTop: 16 }}>
          <button type="submit">Create account</button>
        </p>
      </form>
      <p className="muted">
        Already applied? <Link href="/login">Log in</Link>.
      </p>
    </>
  );
}
