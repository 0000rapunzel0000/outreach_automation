import type { Prisma } from "@prisma/client";
import { db, type DbOrTx } from "@/lib/db";

export type AuditAction =
  | "person.submit"
  | "person.approve"
  | "person.reject"
  | "person.suspend"
  | "person.reactivate"
  | "person.offboard"
  | "person.purged"
  | "pii.reveal"
  | "tos.create"
  | "tos.publish"
  | "settings.update"
  | "nudge.manual"
  | "wa.relink"
  | "wa.logout"
  | "incident.resolve"
  | "linkedin.deleted_externally"
  | "linkedin.duplicate_blocked"
  | "flag.resolve";

export async function audit(
  entry: {
    actorId?: string | null; // null = system
    action: AuditAction;
    targetType: string;
    targetId?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
  client: DbOrTx = db,
) {
  await client.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata,
    },
  });
}
