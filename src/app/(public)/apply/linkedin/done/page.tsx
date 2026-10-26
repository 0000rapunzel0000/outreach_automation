import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Steps } from "../../Steps";
import { STEP } from "@/lib/onboarding/steps";
import { WaitForLinkedIn } from "./WaitForLinkedIn";

// Unipile's success redirect lands here. The notify callback may arrive before or after it, so we poll.
export default async function LinkedInDone() {
  const user = await currentUser();
  if (!user?.person) redirect("/login");
  return (
    <>
      <Steps current={STEP.linkedin} />
      <h1>Finishing your LinkedIn connection…</h1>
      <WaitForLinkedIn />
    </>
  );
}
