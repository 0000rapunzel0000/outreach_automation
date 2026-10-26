import "server-only";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { needsTosAcceptance } from "@/lib/tos";

/**
 * Employee pages. The TOS gate (§10) redirects to /portal/terms until the current
 * version is accepted; it's UI only and never touches monitoring.
 */
export async function requireEmployee(opts: { tosPage?: boolean } = {}) {
  const user = await requireRole("EMPLOYEE");
  const person = user.person;
  if (!person) redirect("/forbidden");
  const mustAccept = await needsTosAcceptance(person.id);
  if (mustAccept && !opts.tosPage) redirect("/portal/terms");
  return { user, person, mustAccept };
}
