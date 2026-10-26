import type { Notification } from "@prisma/client";
import { db } from "@/lib/db";
import { env, isProd } from "@/lib/env";
import { HOUR, now } from "@/lib/clock";
import { log, maskPhone } from "@/lib/logger";
import { getSetting } from "@/lib/settings";
import { JOBS, queue } from "@/lib/queue";
import { quietHoursEnd } from "./quietHours";
import { NUDGE_TEMPLATES, QUIET_HOURS_TEMPLATES, render, subjectFor, type TemplateKey } from "./templates";
import { emailProvider } from "./providers/email";
import type { NotifyProvider, WhatsAppProvider } from "./providers/types";

export type Channel = "whatsapp" | "email";

export const WA_HOURLY_CAP = 30;
const MAX_ATTEMPTS = 3;

// ---- provider registry (the worker registers Baileys; tests register fakes) ----

let waProvider: WhatsAppProvider | null = null;
let mailProvider: NotifyProvider = emailProvider;

export function setWhatsAppProvider(p: WhatsAppProvider | null) {
  waProvider = p;
}
export function setEmailProvider(p: NotifyProvider) {
  mailProvider = p;
}
export function getWhatsAppProvider() {
  return waProvider;
}

export function firstNameOf(fullName?: string | null) {
  return fullName?.trim().split(/\s+/)[0] ?? "there";
}

type NotifyOpts = {
  incidentId?: string;
  bypassQuietHours?: boolean;
  /** Ordered: first is primary, the rest are fallbacks. Default: WhatsApp, then email. */
  channels?: Channel[];
  /** Override destination (e.g. OTP to a number not yet saved). */
  to?: Partial<Record<Channel, string>>;
  priority?: number;
};

/**
 * Queue a message to a person (§5). Writes Notification rows; the worker's
 * deliver-notification job does the actual send. Returns the primary row.
 */
export async function notify(personId: string, templateKey: TemplateKey, vars: Record<string, string> = {}, opts: NotifyOpts = {}) {
  const person = await db.person.findUnique({ where: { id: personId }, include: { user: true } });
  if (!person) throw new Error(`notify: unknown person ${personId}`);
  const addresses: Record<Channel, string | null> = {
    whatsapp: opts.to?.whatsapp ?? person.whatsappE164,
    email: opts.to?.email ?? person.user.email,
  };
  const body = render(templateKey, { firstName: firstNameOf(person.fullName), ...vars });
  return enqueueMessage({ personId, templateKey, body, addresses, opts });
}

/** Alert every SUPER_ADMIN and REVIEWER. WhatsApp (if they have a number) with email fallback; never waits for quiet hours. */
export async function notifyAdmins(templateKey: TemplateKey, vars: Record<string, string> = {}, opts: { channels?: Channel[]; incidentId?: string } = {}) {
  const admins = await db.user.findMany({ where: { role: { in: ["SUPER_ADMIN", "REVIEWER"] } } });
  const body = render(templateKey, vars);
  const channels = opts.channels ?? ["whatsapp", "email"];
  const emailed = new Set<string>();
  for (const a of admins) {
    const useChannels = channels.filter((c) => (c === "whatsapp" ? !!a.whatsappE164 : true));
    if (!useChannels.length) continue;
    if (useChannels.includes("email")) emailed.add(a.email.toLowerCase());
    await enqueueMessage({
      personId: null,
      templateKey,
      body,
      addresses: { whatsapp: a.whatsappE164, email: a.email },
      opts: { channels: useChannels, bypassQuietHours: true, incidentId: opts.incidentId },
    });
  }
  // ADMIN_ALERT_EMAILS get email copies of every admin alert.
  if (channels.includes("email")) {
    for (const addr of env().ADMIN_ALERT_EMAILS) {
      if (emailed.has(addr.toLowerCase())) continue;
      await enqueueMessage({
        personId: null,
        templateKey,
        body,
        addresses: { whatsapp: null, email: addr },
        opts: { channels: ["email"], bypassQuietHours: true, incidentId: opts.incidentId },
      });
    }
  }
}

/** Settings page "send test": one message per channel to explicit addresses, no fallback. */
export async function sendTestMessages(to: Partial<Record<Channel, string>>) {
  const rows = [];
  for (const channel of ["whatsapp", "email"] as Channel[]) {
    if (!to[channel]) continue;
    rows.push(
      await enqueueMessage({
        personId: null,
        templateKey: "test",
        body: render("test", { channel: channel === "whatsapp" ? "WhatsApp" : "email" }),
        addresses: { whatsapp: null, email: null, [channel]: to[channel]! } as Record<Channel, string | null>,
        opts: { channels: [channel], bypassQuietHours: true },
      }),
    );
  }
  return rows;
}

async function enqueueMessage(p: {
  personId: string | null;
  templateKey: TemplateKey;
  body: string;
  addresses: Record<Channel, string | null>;
  opts: NotifyOpts;
}) {
  const channels = (p.opts.channels ?? ["whatsapp", "email"]).filter((c) => !!p.addresses[c]);
  if (!channels.length) {
    log.warn("notify: no address for any channel", { templateKey: p.templateKey, personId: p.personId });
    return null;
  }
  const [primary, ...fallbacks] = channels;

  let startAfter: Date | undefined;
  if (QUIET_HOURS_TEMPLATES.has(p.templateKey) && !p.opts.bypassQuietHours) {
    const qh = await getSetting("quietHours");
    startAfter = quietHoursEnd(now(), qh) ?? undefined;
  }

  const row = await db.notification.create({
    data: {
      personId: p.personId,
      incidentId: p.opts.incidentId,
      channel: primary,
      templateKey: p.templateKey,
      toAddress: p.addresses[primary]!,
      body: p.body,
      status: startAfter ? "deferred_quiet_hours" : "queued",
    },
  });
  await queue().send(
    JOBS.deliverNotification,
    { notificationId: row.id, fallbacks: fallbacks.map((c) => ({ channel: c, to: p.addresses[c] })) },
    { startAfter, priority: p.opts.priority },
  );
  return row;
}

type DeliverJob = { notificationId: string; fallbacks?: { channel: Channel; to: string }[] };

/** Worker job: send one Notification, with WhatsApp -> email fallback. Throws to let pg-boss retry. */
export async function deliverNotification(job: DeliverJob) {
  const n = await db.notification.findUnique({ where: { id: job.notificationId } });
  if (!n || !["queued", "deferred_quiet_hours"].includes(n.status)) return;

  // A deferred or late nudge is pointless if they reconnected meanwhile.
  if (n.incidentId && NUDGE_TEMPLATES.has(n.templateKey as TemplateKey)) {
    const inc = await db.incident.findUnique({ where: { id: n.incidentId } });
    if (!inc || inc.resolvedAt) {
      await db.notification.update({ where: { id: n.id }, data: { status: "skipped", error: "incident_resolved" } });
      return;
    }
  }

  try {
    if (n.channel === "whatsapp") return await deliverWhatsApp(n, job);
    return await deliverEmail(n);
  } finally {
    await redactSecrets(n.id);
  }
}

/** OTP bodies hold a live code: once a row is final, keep the log entry but drop the code. */
async function redactSecrets(id: string) {
  await db.notification.updateMany({
    where: { id, templateKey: "otp", status: { in: ["sent", "failed", "skipped"] } },
    data: { body: render("otp", { code: "******" }) },
  });
}

async function deliverWhatsApp(n: Notification, job: DeliverJob) {
  if (env().WA_DISABLED) {
    // Bodies carry reconnect links and OTPs, which are credentials: only log them outside production.
    log.info("WA_DISABLED: whatsapp not sent", { to: maskPhone(n.toAddress), templateKey: n.templateKey, ...(isProd() ? {} : { body: n.body }) });
    await db.notification.update({ where: { id: n.id }, data: { status: "skipped", error: "wa_disabled" } });
    return;
  }

  const p = waProvider;
  if (!p || !(await p.isHealthy())) {
    await db.notification.update({ where: { id: n.id }, data: { status: "failed", error: "wa_unhealthy" } });
    await fallback(n, job, "wa_unhealthy");
    return;
  }

  // Hourly cap (§5.1): leave it queued and try again when the oldest send in the window ages out.
  const hourAgo = new Date(now().getTime() - HOUR);
  const recent = await db.notification.findMany({
    where: { channel: "whatsapp", status: "sent", sentAt: { gte: hourAgo } },
    orderBy: { sentAt: "asc" },
    select: { sentAt: true },
  });
  if (recent.length >= WA_HOURLY_CAP && n.templateKey !== "otp") {
    const retryAt = new Date(recent[0].sentAt!.getTime() + HOUR + 1000);
    await queue().send(JOBS.deliverNotification, job, { startAfter: retryAt });
    log.info("whatsapp hourly cap reached; rescheduled", { notificationId: n.id, retryAt });
    return;
  }

  const attempts = n.attempts + 1;
  try {
    const r = await p.send(n.toAddress, n.body);
    await db.notification.update({
      where: { id: n.id },
      data: { status: "sent", attempts, sentAt: now(), providerMessageId: r.providerMessageId, error: null },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (attempts >= MAX_ATTEMPTS) {
      await db.notification.update({ where: { id: n.id }, data: { status: "failed", attempts, error: msg.slice(0, 500) } });
      await fallback(n, job, "wa_failed");
      return;
    }
    await db.notification.update({ where: { id: n.id }, data: { attempts, error: msg.slice(0, 500) } });
    throw e;
  }
}

async function deliverEmail(n: Notification) {
  const attempts = n.attempts + 1;
  try {
    const r = await mailProvider.send(n.toAddress, n.body, subjectFor(n.templateKey as TemplateKey));
    await db.notification.update({
      where: { id: n.id },
      data: { status: "sent", attempts, sentAt: now(), providerMessageId: r.providerMessageId },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.notification.update({
      where: { id: n.id },
      data: { attempts, status: attempts >= MAX_ATTEMPTS ? "failed" : n.status, error: msg.slice(0, 500) },
    });
    if (attempts < MAX_ATTEMPTS) throw e;
  }
}

async function fallback(n: Notification, job: DeliverJob, reason: string) {
  const next = job.fallbacks?.[0];
  if (!next) return;
  const row = await db.notification.create({
    data: {
      personId: n.personId,
      incidentId: n.incidentId,
      channel: next.channel,
      templateKey: n.templateKey,
      toAddress: next.to,
      body: n.body,
      status: "queued",
      error: `fallback_for:${n.id} (${reason})`,
    },
  });
  await queue().send(JOBS.deliverNotification, { notificationId: row.id, fallbacks: job.fallbacks!.slice(1) });
}

/** Send straight from the web process, no queue. Only for the worker-silent watchdog (the worker can't deliver). */
export async function sendEmailNow(to: string, templateKey: TemplateKey, vars: Record<string, string> = {}) {
  const body = render(templateKey, vars);
  const row = await db.notification.create({ data: { channel: "email", templateKey, toAddress: to, body, status: "queued" } });
  await deliverEmail(row);
}
