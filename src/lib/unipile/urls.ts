import { env } from "@/lib/env";
import type { HostedAuthOpts } from "./types";

export function notifyUrl() {
  return `${env().APP_BASE_URL}/api/unipile/notify?s=${encodeURIComponent(env().UNIPILE_NOTIFY_SECRET)}`;
}

export function webhookUrl() {
  return `${env().APP_BASE_URL}/api/webhooks/unipile`;
}

export function redirectUrls(type: HostedAuthOpts["type"]) {
  const base = env().APP_BASE_URL;
  return type === "create"
    ? { success: `${base}/apply/linkedin/done`, failure: `${base}/apply/linkedin?error=1` }
    : { success: `${base}/portal?reconnected=1`, failure: `${base}/portal?reconnect_error=1` };
}

export function linkedinProfileUrl(publicIdentifier?: string | null) {
  return publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}` : null;
}
