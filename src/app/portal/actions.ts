"use server";

import { redirect } from "next/navigation";
import { clientIp, userAgent } from "@/lib/auth";
import { errMsg, fail } from "@/lib/flash";
import { rateLimit } from "@/lib/ratelimit";
import { startReconnect } from "@/lib/monitoring/reconnect";
import { acceptTos, currentTos } from "@/lib/tos";
import { requireEmployee } from "./guard";

/** Same flow as /r/<token>, from a logged-in session. */
export async function reconnectLinkedIn() {
  const { person } = await requireEmployee({ tosPage: true });
  if (!(await rateLimit(`reconnect:${person.id}`, 10, 600))) fail("/portal", "Too many attempts. Wait a few minutes.");
  let r: Awaited<ReturnType<typeof startReconnect>>;
  try {
    r = await startReconnect(person.id);
  } catch (e) {
    fail("/portal", `Couldn't start the reconnection: ${errMsg(e)}`);
  }
  if (r.kind === "redirect") redirect(r.url);
  if (r.kind === "already_connected") redirect("/portal?ok=" + encodeURIComponent("You're already connected ✓"));
  fail("/portal", "Reconnecting isn't available for your account. Contact an admin.");
}

export async function reacceptTerms(form: FormData) {
  const { person } = await requireEmployee({ tosPage: true });
  const tos = await currentTos();
  if (!tos || form.get("tosVersionId") !== tos.id) fail("/portal/terms", "The Terms changed while you were reading. Please review them again.");
  if (form.get("agree") !== "on") fail("/portal/terms", "Tick the box to agree.");
  await acceptTos(person.id, tos.id, await clientIp(), await userAgent());
  redirect("/portal");
}
