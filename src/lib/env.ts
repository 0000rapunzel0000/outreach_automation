import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    APP_BASE_URL: z.string().url().transform((u) => u.replace(/\/$/, "")),
    UNIPILE_FAKE: bool,
    UNIPILE_DSN: z.string().default(""),
    UNIPILE_API_KEY: z.string().default(""),
    UNIPILE_WEBHOOK_SECRET: z.string().min(32, "UNIPILE_WEBHOOK_SECRET must be 32+ chars"),
    UNIPILE_NOTIFY_SECRET: z.string().min(16),
    FIELD_ENCRYPTION_KEY: z
      .string()
      .refine((k) => Buffer.from(k, "base64").length === 32, "FIELD_ENCRYPTION_KEY must be 32 bytes, base64"),
    RECONNECT_TOKEN_SECRET: z.string().min(16),
    OTP_PEPPER: z.string().min(16).optional(),
    EMAIL_FROM: z.string().min(1),
    RESEND_API_KEY: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    ADMIN_ALERT_EMAILS: z
      .string()
      .default("")
      .transform((s) => s.split(",").map((e) => e.trim()).filter(Boolean)),
    WA_DISABLED: bool,
    EMAIL_DISABLED: bool,
    SEED_ADMIN_EMAIL: z.string().email().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(10).optional(),
  })
  .superRefine((e, ctx) => {
    if (!e.UNIPILE_FAKE) {
      if (!e.UNIPILE_DSN) ctx.addIssue({ code: "custom", path: ["UNIPILE_DSN"], message: "required unless UNIPILE_FAKE=true" });
      if (!e.UNIPILE_API_KEY) ctx.addIssue({ code: "custom", path: ["UNIPILE_API_KEY"], message: "required unless UNIPILE_FAKE=true" });
    }
    if (!e.EMAIL_DISABLED && !e.RESEND_API_KEY && !e.SMTP_HOST) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "set RESEND_API_KEY or SMTP_* (or EMAIL_DISABLED=true)" });
    }
    if (e.NODE_ENV === "production" && e.UNIPILE_FAKE) {
      ctx.addIssue({ code: "custom", path: ["UNIPILE_FAKE"], message: "must be false in production" });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated env. Throws with every problem listed on first use (fail fast at boot). */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}

export function isProd() {
  return process.env.NODE_ENV === "production";
}
