"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { audit } from "@/lib/audit";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth";
import { errMsg, fail, succeed } from "@/lib/flash";
import { toE164 } from "@/lib/phone";
import { SETTINGS, type SettingKey, setState } from "@/lib/settings";
import { sendTestMessages } from "@/lib/notify";
import * as life from "@/lib/person/lifecycle";
import * as tos from "@/lib/tos";

const personPath = (id: string) => `/admin/people/${id}`;

async function run(back: string, okMsg: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    fail(back, errMsg(e));
  }
  revalidatePath("/admin", "layout");
  succeed(back, okMsg);
}

// ---- Applications (REVIEWER+) ----

export async function approveApplication(form: FormData) {
  const actor = await requireAdmin();
  const id = String(form.get("personId"));
  await run(`/admin/applications/${id}`, "Approved. They're now active and monitored.", () => life.approve(id, actor.id));
}

export async function rejectApplication(form: FormData) {
  const actor = await requireAdmin();
  const id = String(form.get("personId"));
  const reason = String(form.get("reason") ?? "");
  await run(`/admin/applications/${id}`, "Rejected. Their LinkedIn is being removed from Unipile.", () => life.reject(id, actor.id, reason));
}

// ---- Employee lifecycle ----

export async function suspendPerson(form: FormData) {
  const actor = await requireAdmin();
  const id = String(form.get("personId"));
  await run(personPath(id), "Suspended. Monitoring continues; nudges are paused.", () => life.suspend(id, actor.id));
}

export async function reactivatePerson(form: FormData) {
  const actor = await requireAdmin();
  const id = String(form.get("personId"));
  await run(personPath(id), "Reactivated.", () => life.reactivate(id, actor.id));
}

export async function offboardPerson(form: FormData) {
  const actor = await requireSuperAdmin();
  const id = String(form.get("personId"));
  if (form.get("confirm") !== "OFFBOARD") fail(personPath(id), "Type OFFBOARD to confirm.");
  await run(personPath(id), "Offboarded. LinkedIn removed from Unipile.", () => life.offboard(id, actor.id));
}

export async function nudgeNow(form: FormData) {
  const actor = await requireAdmin();
  const id = String(form.get("personId"));
  await run(personPath(id), "Nudge queued.", () => life.manualNudge(id, actor.id));
}

export async function resolveFlag(form: FormData) {
  const actor = await requireAdmin();
  const id = String(form.get("flagId"));
  await db.adminFlag.update({ where: { id }, data: { resolvedAt: now(), resolvedBy: actor.id } });
  await audit({ actorId: actor.id, action: "flag.resolve", targetType: "flag", targetId: id });
  revalidatePath("/admin/team");
  redirect(String(form.get("back") ?? "/admin/team"));
}

// ---- TOS (SUPER_ADMIN) ----

export async function createTosDraft(form: FormData) {
  const actor = await requireSuperAdmin();
  const md = String(form.get("contentMd") ?? "").trim();
  if (md.length < 20) fail("/admin/tos/new", "The Terms are too short.");
  const v = await tos.createDraft(md, actor.id);
  succeed(`/admin/tos/${v.id}`, `Draft v${v.version} saved.`);
}

export async function saveTosDraft(form: FormData) {
  await requireSuperAdmin();
  const id = String(form.get("id"));
  const md = String(form.get("contentMd") ?? "").trim();
  await run(`/admin/tos/${id}`, "Draft saved.", () => tos.updateDraft(id, md));
}

export async function publishTos(form: FormData) {
  const actor = await requireSuperAdmin();
  const id = String(form.get("id"));
  await run(`/admin/tos/${id}`, "Published. Active employees will be asked to accept it.", () => tos.publish(id, actor.id));
}

// ---- Settings (SUPER_ADMIN) ----

export async function saveSettings(form: FormData) {
  const actor = await requireSuperAdmin();
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    const def = SETTINGS[key];
    let raw: unknown;
    if (key === "quietHours") raw = { start: form.get("quietHours.start"), end: form.get("quietHours.end"), tz: "Asia/Kolkata" };
    else if (typeof def.default === "boolean") raw = form.get(key) === "on";
    else raw = Number(form.get(key));
    const parsed = def.schema.safeParse(raw);
    if (!parsed.success) fail("/admin/settings", `${def.label}: ${parsed.error.issues[0].message}`);
    const existing = await db.setting.findUnique({ where: { key } });
    const before = existing?.value ?? def.default;
    if (JSON.stringify(before) !== JSON.stringify(parsed.data)) {
      changes[key] = { from: before, to: parsed.data };
      await setState(key, parsed.data as Prisma.InputJsonValue);
    }
  }
  if (Object.keys(changes).length) {
    await audit({ actorId: actor.id, action: "settings.update", targetType: "settings", metadata: changes as Prisma.InputJsonValue });
  }
  const note = changes["reconciler.intervalMin"] ? " Restart the worker to apply the new reconciler interval." : "";
  succeed("/admin/settings", Object.keys(changes).length ? `Settings saved.${note}` : "No changes.");
}

export async function waCommand(form: FormData) {
  const actor = await requireSuperAdmin();
  const cmd = String(form.get("cmd"));
  if (cmd !== "relink" && cmd !== "logout") fail("/admin/settings", "Unknown command.");
  const pairingRaw = String(form.get("pairingPhone") ?? "").trim();
  const pairingPhone = pairingRaw ? toE164(pairingRaw) : undefined;
  if (pairingRaw && !pairingPhone) fail("/admin/settings", "Enter the sender phone number in full, e.g. +91 98765 43210.");
  // Audited by the worker when it carries the command out.
  await setState("wa.command", { cmd, actorId: actor.id, ...(pairingPhone ? { pairingPhone } : {}) });
  succeed("/admin/settings", cmd === "relink" ? "Re-link requested. A QR code will appear here within a few seconds." : "Log-out requested.");
}

export async function sendTest(form: FormData) {
  await requireSuperAdmin();
  const wa = String(form.get("whatsapp") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const waE164 = wa ? toE164(wa) : null;
  if (wa && !waE164) fail("/admin/settings", "Invalid WhatsApp number.");
  if (!waE164 && !email) fail("/admin/settings", "Enter a WhatsApp number or an email.");
  await sendTestMessages({ whatsapp: waE164 ?? undefined, email: email || undefined });
  succeed("/admin/settings", "Test message(s) queued. Check the log below.");
}

export async function saveMyWhatsApp(form: FormData) {
  const actor = await requireAdmin();
  const raw = String(form.get("whatsapp") ?? "").trim();
  const e164 = raw ? toE164(raw) : null;
  if (raw && !e164) fail("/admin/me", "Invalid WhatsApp number.");
  await db.user.update({ where: { id: actor.id }, data: { whatsappE164: e164 } });
  succeed("/admin/me", e164 ? "Escalations will reach you on WhatsApp." : "WhatsApp alerts turned off for you.");
}
