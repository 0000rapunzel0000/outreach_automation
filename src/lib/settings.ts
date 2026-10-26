import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, type DbOrTx } from "@/lib/db";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

/** Admin-editable settings (§3). Each has a schema and a default. */
export const SETTINGS = {
  "nudge.firstDelayMin": { schema: z.number().int().min(0).max(1440), default: 0, label: "First nudge delay (min)" },
  "nudge.secondDelayMin": { schema: z.number().int().min(1).max(10080), default: 120, label: "Second nudge after start (min)" },
  "nudge.escalateAfterMin": { schema: z.number().int().min(1).max(20160), default: 1440, label: "Escalate after start (min)" },
  "nudge.dailyReminderAfterEscalation": { schema: z.boolean(), default: true, label: "Daily reminder after escalation" },
  "nudge.maxNudges": { schema: z.number().int().min(1).max(100), default: 10, label: "Max nudges per incident" },
  "nudge.errorGraceMin": { schema: z.number().int().min(0).max(240), default: 10, label: "ERROR grace period (min)" },
  "nudge.flapWindowMin": { schema: z.number().int().min(0).max(1440), default: 30, label: "Flap window (min)" },
  quietHours: {
    schema: z.object({ start: hhmm, end: hhmm, tz: z.literal("Asia/Kolkata") }),
    default: { start: "22:00", end: "08:00", tz: "Asia/Kolkata" as const },
    label: "Quiet hours (IST)",
  },
  "reconciler.intervalMin": { schema: z.number().int().min(1).max(1440), default: 15, label: "Reconciler interval (min)" },
  "retention.rejectedDays": { schema: z.number().int().min(1).max(3650), default: 30, label: "Purge rejected after (days)" },
  "retention.offboardedDays": {
    schema: z.number().int().min(0).max(3650),
    default: 0,
    label: "Purge offboarded after (days, 0 = never)",
  },
  "reconnectToken.ttlHours": { schema: z.number().int().min(1).max(720), default: 72, label: "Reconnect link TTL (hours)" },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

export async function getSetting<K extends SettingKey>(key: K, client: DbOrTx = db): Promise<SettingValue<K>> {
  const row = await client.setting.findUnique({ where: { key } });
  const parsed = SETTINGS[key].schema.safeParse(row?.value);
  return (parsed.success ? parsed.data : SETTINGS[key].default) as SettingValue<K>;
}

export async function getAllSettings(client: DbOrTx = db) {
  const rows = await client.setting.findMany({ where: { key: { in: Object.keys(SETTINGS) } } });
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(SETTINGS) as SettingKey[]) {
    const parsed = SETTINGS[k].schema.safeParse(rows.find((r) => r.key === k)?.value);
    out[k] = parsed.success ? parsed.data : SETTINGS[k].default;
  }
  return out as { [K in SettingKey]: SettingValue<K> };
}

export type NudgeSettings = Awaited<ReturnType<typeof getAllSettings>>;

// Runtime state keys (not admin-editable): wa.status, wa.pendingQr, wa.command, worker.heartbeat, ...
export async function getState<T = unknown>(key: string, client: DbOrTx = db): Promise<T | null> {
  const row = await client.setting.findUnique({ where: { key } });
  return (row?.value as T) ?? null;
}

export async function setState(key: string, value: Prisma.InputJsonValue, client: DbOrTx = db) {
  await client.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function clearState(key: string, client: DbOrTx = db) {
  await client.setting.deleteMany({ where: { key } });
}
