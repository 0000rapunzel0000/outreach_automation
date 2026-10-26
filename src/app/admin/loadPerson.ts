import "server-only";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth";

/** Load a person for an admin page; audits a PII reveal (SUPER_ADMIN only) every time it's rendered. */
export async function loadPersonForAdmin(id: string, viewer: CurrentUser, wantReveal: boolean) {
  const p = await db.person.findUnique({
    where: { id },
    include: { user: true, linkedin: true, tosAcceptances: { include: { tosVersion: true } } },
  });
  if (!p) notFound();
  const canReveal = viewer.role === "SUPER_ADMIN";
  const reveal = canReveal && wantReveal;
  if (reveal) await audit({ actorId: viewer.id, action: "pii.reveal", targetType: "person", targetId: id });
  return { p, canReveal, reveal };
}
