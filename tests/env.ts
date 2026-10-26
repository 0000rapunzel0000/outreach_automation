// Test environment: a separate database and fixed secrets. Imported before anything reads env().
export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://subhashreepati@localhost:5432/outreach_test";

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: TEST_DB,
  APP_BASE_URL: "http://localhost:3999",
  UNIPILE_FAKE: "true",
  UNIPILE_WEBHOOK_SECRET: "test-webhook-secret-0123456789abcdef",
  UNIPILE_NOTIFY_SECRET: "test-notify-secret-0123",
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  RECONNECT_TOKEN_SECRET: "test-reconnect-secret-0123",
  OTP_PEPPER: "test-otp-pepper-0123",
  EMAIL_FROM: "test@example.test",
  EMAIL_DISABLED: "true",
  ADMIN_ALERT_EMAILS: "",
  WA_DISABLED: "false",
});
