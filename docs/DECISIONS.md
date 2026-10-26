# Decisions

Deviations from SPEC.md and answers to its open decisions (§16). Newest first within each section.

## Provider-doc discrepancies

### Account source status `PERMISSIONS` (checked 2026-10-26)
- **Spec (§4 table):** lists OK, CREATION_SUCCESS, RECONNECTED, SYNC_SUCCESS, CONNECTING, CREDENTIALS, STOPPED, ERROR and DELETED. Anything else is treated as unknown and goes to TRANSIENT_ERROR.
- **Unipile docs:** `AccountSourceServiceStatus` in
  [Retrieve an account](https://developer.unipile.com/reference/accountscontroller_getaccountbyid) is OK, STOPPED, ERROR, CREDENTIALS,
  CONNECTING and **PERMISSIONS** ("some permissions are missing on the host device").
- **Done:** `PERMISSIONS` maps to `NEEDS_RECONNECT`, because the user has to act. The account fields we read (`sources[].status`, `connection_params.im.id`,
  `connection_params.im.publicIdentifier`, `name`) all match the docs.
- **Related fix:** `promote-error` used to escalate only if the live status was exactly `ERROR`. An unknown status would have stayed
  TRANSIENT_ERROR forever and never sent a nudge. It now promotes any live status that still normalises to TRANSIENT_ERROR.

### Hosted-auth reconnect body has no `providers` (checked 2026-10-26)
- **Spec (§4):** sends `providers: ["LINKEDIN"]` for both `create` and `reconnect`.
- **Unipile docs:** the request schema at
  [Connect an account (hosted authentication)](https://developer.unipile.com/reference/hostedcontroller_requestlink)
  has two variants. "Connection link" requires `providers`. "Reconnection link" requires `reconnect_account` and has no `providers` property.
- **Done:** `hostedAuthBody()` in `src/lib/unipile/client.ts` sends `providers` only for `create`.
- Everything else in §4's hosted-auth call matches the docs: the endpoint, `X-API-KEY`, `api_url`, `expiresOn`, `notify_url`, `name`,
  `success_redirect_url` / `failure_redirect_url`, the `{ object, url }` response and the
  `{ status: CREATION_SUCCESS | RECONNECTED, account_id, name }` notify payload.
- The docs add that **every link expires at Unipile's daily restart**, whatever `expiresOn` says. The spec's design already handles this: `/r/<token>` mints a fresh Unipile link on every click.
- Not used yet, but available: `bypass_success_screen` (skip Unipile's success screen) and `single_use`.

## Deviations from SPEC.md

| Area | Spec | What was built | Why |
|---|---|---|---|
| Existing dashboard | "Adapt to the existing dashboard" | A standalone Next.js app | No dashboard codebase was provided. Payroll is reached only through `src/lib/payroll/hooks.ts`. |
| Auth (§1) | Reuse dashboard auth, else Auth.js | Own DB sessions (`Session` table, httpOnly cookie, bcrypt) + `requireRole()` | Fewer moving parts than Auth.js. Swap in the dashboard's auth by replacing `src/lib/auth`. |
| Signup (§8 step 0) | Email + password **or** email OTP | Email + password only | Email-OTP signup is optional in the spec. |
| Idempotency guard (§6 step 1) | Early return for a repeated raw status from `reconciler` | Also for repeated `webhook` | Makes "the same webhook twice" a no-op even after a promotion. |
| Resolution (§6) | "Not ACTIVE → record only" | `CONNECTED` resolves an open incident whatever the status; opening and nudging stay ACTIVE-only | Otherwise a suspended person's incident never closes and their uptime is wrong. |
| Reactivate (§10) | Re-run `applyStatus` | Also re-schedules the next ladder rung for an incident that was open through the suspension | Suspend cancels the jobs, so without this the ladder would stall. |
| Manual nudge | Audited | Sends `nudge_2` wording, bypasses quiet hours, doesn't move the ladder | An admin chose to send it now. |
| Admin WhatsApp | "WhatsApp to every SUPER_ADMIN and REVIEWER" | `User.whatsappE164`, set by each admin under **My alerts**. Email when it isn't set. | Admins had nowhere to store a number. |
| Extra tables | — | `Session`, `AdminFlag`, `WorkerCommand` (web → worker RPC), `RateLimit`, `FakeUnipileAccount` | Needed for auth, the admin flags §6 asks for, the onWhatsApp RPC (§8), rate limits (§13) and fake mode (§12). |
| Unipile success redirect for reconnect | `/portal?reconnected=1` | Same URL, but it shows a public thank-you page when not logged in | People tap WhatsApp links on phones where they aren't logged in. |
| OTP privacy | — | OTP bodies are redacted in `Notification` once final. The dev-mode code goes to the page in a 10-minute cookie, never the URL. With `WA_DISABLED`, message bodies are logged only outside production. | OTPs and reconnect links are credentials. |
| Uptime | "minus suspended spans if tracked" | Suspensions aren't stored as history, so suspended time counts as active | Add a span table if payroll needs it. |
| Reconciler interval | Admin-editable | Read at worker boot; the settings page says to restart the worker after changing it | pg-boss cron schedules are set at start. |
| Versions | Pin Baileys | `baileys@6.7.24`, `next@15.5.27` | 6.7.18 and 15.5.4 have published security advisories. |

## Open decisions (§16): defaults in place

| # | Decision | Implemented default | Where to change it |
|---|---|---|---|
| D1 | LinkedIn before or after approval | Before (step 3) | `src/lib/onboarding/steps.ts` |
| D2 | Uptime → pay | Not wired. `monthlyUptime()` only. | `src/lib/monitoring/uptime.ts` |
| D3 | Personal/payroll fields | Name, mobile, WhatsApp, address, PAN, bank+IFSC or UPI | `DETAIL_FIELDS` + `saveDetails` in `src/app/(public)/apply/actions.ts` |
| D4 | Offboarded retention | No purge (`retention.offboardedDays = 0`) | Admin → Settings |
| D5 | Nudge timings / quiet hours | §3 defaults | Admin → Settings |
| D6 | Show rejection reason | No | `src/app/(public)/apply/status/page.tsx` |
| D7 | WhatsApp provider | Baileys, with a `CloudApiProvider` stub | `worker/index.ts`, `src/lib/notify/providers/cloudapi.ts` |
| D8 | Payroll integration | Stub hooks that log | `src/lib/payroll/hooks.ts` |
