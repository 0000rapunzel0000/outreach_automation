import { z } from "zod";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { log } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { unipile } from "@/lib/unipile";
import { notifyAdmins } from "@/lib/notify";
import { env } from "@/lib/env";
import { STEP } from "@/lib/onboarding/steps";
import { applyStatus } from "./applyStatus";

export const notifyBody = z
  .object({
    status: z.string(),
    account_id: z.string().min(1),
    name: z.string().min(1),
  })
  .passthrough();

export type NotifyResult = { ok: boolean; reason?: string };

/**
 * Hosted-auth notify_url (§4.1). The body is only a hint: the account is confirmed
 * with getAccount() before anything is stored.
 */
export async function handleHostedAuthNotify(body: z.infer<typeof notifyBody>): Promise<NotifyResult> {
  const personId = body.name;
  const person = await db.person.findUnique({ where: { id: personId }, include: { linkedin: true } });
  if (!person) return { ok: false, reason: "unknown_person" };

  const account = await unipile().getAccount(body.account_id);
  if (!account || account.type !== "LINKEDIN") return { ok: false, reason: "account_not_found" };

  const existing = person.linkedin;
  const isReconnect = existing?.unipileAccountId === account.id;
  if (!isReconnect && (person.onboardingStep < STEP.linkedin || existing)) {
    // A create for someone not at the LinkedIn step (or who already has one).
    log.warn("notify: unexpected create", { personId, step: person.onboardingStep, hasExisting: !!existing });
    if (existing) return { ok: false, reason: "already_linked" };
    return { ok: false, reason: "wrong_step" };
  }

  if (!isReconnect) {
    // One LinkedIn, one person.
    const dupe = await db.linkedInAccount.findFirst({
      where: {
        personId: { not: personId },
        OR: [
          ...(account.providerUserId ? [{ providerUserId: account.providerUserId }] : []),
          ...(account.profileUrl ? [{ profileUrl: account.profileUrl }] : []),
        ],
      },
    });
    if (dupe) {
      await unipile().deleteAccount(account.id);
      await db.person.update({ where: { id: personId }, data: { linkedinError: "duplicate_linkedin" } });
      await audit({
        action: "linkedin.duplicate_blocked",
        targetType: "person",
        targetId: personId,
        metadata: { unipileAccountId: account.id, matchesPersonId: dupe.personId },
      });
      await db.adminFlag.create({
        data: { kind: "duplicate_linkedin", personId, message: `Applicant tried to connect a LinkedIn already linked to another person.` },
      });
      await notifyAdmins("admin_flag", {
        message: "Duplicate LinkedIn connection blocked.",
        adminLink: `${env().APP_BASE_URL}/admin/people/${personId}`,
      }, { channels: ["email"] });
      return { ok: false, reason: "duplicate_linkedin" };
    }
  }

  const t = now();
  const acct = await db.linkedInAccount.upsert({
    where: { personId },
    create: {
      personId,
      unipileAccountId: account.id,
      providerUserId: account.providerUserId,
      displayName: account.displayName,
      profileUrl: account.profileUrl,
      status: "CONNECTING",
      connectedAt: t,
    },
    update: {
      displayName: account.displayName ?? undefined,
      profileUrl: account.profileUrl ?? undefined,
      providerUserId: account.providerUserId ?? undefined,
    },
  });

  if (!isReconnect) {
    await db.person.update({
      where: { id: personId },
      data: { linkedinError: null, onboardingStep: Math.max(person.onboardingStep, STEP.review) },
    });
  }

  // Use the live status, so a just-created account that's already in trouble is recorded as such.
  await applyStatus(acct.id, account.rawStatus === "OK" ? body.status : account.rawStatus, "notify_url", {
    payload: { status: body.status },
  });
  return { ok: true };
}
