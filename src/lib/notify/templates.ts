// All message wording in one place (§5). {link} is always ${APP_BASE_URL}/r/<token>.

export const TEMPLATES = {
  otp: "Your verification code is {code}. It expires in 10 minutes.",
  nudge_1: "Hi {firstName}, your LinkedIn got disconnected from the outreach system. Please reconnect here (takes 1 min): {link}",
  nudge_2: "Reminder {firstName}: your LinkedIn is still disconnected. Reconnect here: {link}",
  nudge_final: "{firstName}, your LinkedIn has been disconnected for 24 hours and the admin has been notified. Reconnect: {link}",
  nudge_daily: "Your LinkedIn is still disconnected. Reconnect: {link}",
  reconnected: "Thanks {firstName}, your LinkedIn is connected again.",
  approved: "Welcome aboard, {firstName}! Your application is approved. Log in: {portalLink}",
  rejected: "Hi {firstName}, thanks for applying. We're not moving forward right now.",
  tos_updated: "Our Terms of Service have been updated. Please review and accept: {portalLink}",
  admin_escalation: "[Admin] {fullName} ({phone}) has been disconnected since {since}. {adminLink}",
  admin_new_application: "[Admin] New application from {fullName} is waiting for review. {adminLink}",
  admin_wa_down: "[Admin] WhatsApp sender is logged out. Re-link it: {settingsLink}",
  admin_worker_silent: "[Admin] Worker heartbeat missing for 30 min.",
  admin_flag: "[Admin] {message} {adminLink}",
  test: "Test message from the outreach dashboard. If you can read this, {channel} delivery works.",
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

/** Employee-facing templates respect quiet hours. OTPs and admin alerts never wait. */
export const QUIET_HOURS_TEMPLATES = new Set<TemplateKey>([
  "nudge_1",
  "nudge_2",
  "nudge_final",
  "nudge_daily",
  "reconnected",
  "approved",
  "rejected",
  "tos_updated",
]);

/** Templates that are pointless once the person has reconnected. */
export const NUDGE_TEMPLATES = new Set<TemplateKey>(["nudge_1", "nudge_2", "nudge_final", "nudge_daily"]);

export const EMAIL_SUBJECTS: Partial<Record<TemplateKey, string>> = {
  otp: "Your verification code",
  nudge_1: "Action needed: reconnect your LinkedIn",
  nudge_2: "Reminder: reconnect your LinkedIn",
  nudge_final: "Your LinkedIn has been disconnected for 24 hours",
  nudge_daily: "Your LinkedIn is still disconnected",
  reconnected: "Your LinkedIn is connected again",
  approved: "Your application is approved",
  rejected: "Your application",
  tos_updated: "Our Terms of Service have been updated",
};

export function render(key: TemplateKey, vars: Record<string, string>) {
  return TEMPLATES[key].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

export function subjectFor(key: TemplateKey) {
  return EMAIL_SUBJECTS[key] ?? (key.startsWith("admin_") ? "[Admin] Outreach alert" : "Outreach team");
}
