import { marked } from "marked";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { now } from "@/lib/clock";
import { sha256 } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";

export async function currentTos() {
  return db.tosVersion.findFirst({ where: { isCurrent: true } });
}

/** Markdown -> HTML. Raw HTML in the source is escaped; only SUPER_ADMINs author TOS. */
export function renderTos(md: string) {
  const escaped = md.replace(/</g, "&lt;");
  return marked.parse(escaped, { async: false }) as string;
}

/** True when the person's latest acceptance is older than the current version. */
export async function needsTosAcceptance(personId: string) {
  const cur = await currentTos();
  if (!cur) return false;
  const accepted = await db.tosAcceptance.findUnique({ where: { personId_tosVersionId: { personId, tosVersionId: cur.id } } });
  return !accepted;
}

export async function acceptTos(personId: string, tosVersionId: string, ip: string, userAgent: string) {
  await db.tosAcceptance.upsert({
    where: { personId_tosVersionId: { personId, tosVersionId } },
    create: { personId, tosVersionId, ip, userAgent },
    update: {},
  });
}

export async function createDraft(contentMd: string, actorId: string) {
  const last = await db.tosVersion.findFirst({ orderBy: { version: "desc" } });
  const v = await db.tosVersion.create({ data: { version: (last?.version ?? 0) + 1, contentMd, contentHash: sha256(contentMd) } });
  await audit({ actorId, action: "tos.create", targetType: "tos", targetId: v.id, metadata: { version: v.version } });
  return v;
}

export async function updateDraft(id: string, contentMd: string) {
  const v = await db.tosVersion.findUniqueOrThrow({ where: { id } });
  if (v.publishedAt) throw new Error("Published versions are immutable");
  await db.tosVersion.update({ where: { id }, data: { contentMd, contentHash: sha256(contentMd) } });
}

/** Publish: exactly one current version (enforced in the transaction), then tell every ACTIVE employee. */
export async function publish(id: string, actorId: string) {
  const v = await db.$transaction(async (tx) => {
    const draft = await tx.tosVersion.findUniqueOrThrow({ where: { id } });
    if (draft.publishedAt) throw new Error("Already published");
    await tx.tosVersion.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
    const pub = await tx.tosVersion.update({ where: { id }, data: { isCurrent: true, publishedAt: now(), publishedById: actorId } });
    await audit({ actorId, action: "tos.publish", targetType: "tos", targetId: id, metadata: { version: pub.version, hash: pub.contentHash } }, tx);
    return pub;
  });
  const active = await db.person.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  for (const p of active) await notify(p.id, "tos_updated", { portalLink: `${env().APP_BASE_URL}/portal/terms` });
  return v;
}
