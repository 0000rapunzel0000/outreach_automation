import { db } from "@/lib/db";
import { unipile } from "@/lib/unipile";

export type ReconnectStart = { kind: "redirect"; url: string } | { kind: "already_connected" } | { kind: "unavailable"; reason: string };

/** Shared by the portal button, the pending applicant's status page and /r/<token>: mint a fresh Unipile reconnect link. */
export async function startReconnect(personId: string): Promise<ReconnectStart> {
  const person = await db.person.findUnique({ where: { id: personId }, include: { linkedin: true } });
  if (!person || !["ACTIVE", "PENDING_REVIEW"].includes(person.status)) return { kind: "unavailable", reason: "inactive" };
  const acct = person.linkedin;
  if (!acct || acct.status === "DELETED") return { kind: "unavailable", reason: "no_account" };
  if (acct.status === "CONNECTED") return { kind: "already_connected" };
  const { url } = await unipile().createHostedAuthLink({ type: "reconnect", personId, reconnectAccountId: acct.unipileAccountId });
  return { kind: "redirect", url };
}
