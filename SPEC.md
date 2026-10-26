# SPEC.md — Outreach Team Platform

> **For Claude Code.** This is the authoritative build spec. Implement one milestone at a time (§14). If anything here conflicts with the existing codebase's conventions, **stop and ask** before deviating. If an external API detail here doesn't match the provider's current docs, the **provider docs win**. Note the discrepancy in `docs/DECISIONS.md` and continue.

---

## 0. Context

The business runs LinkedIn outreach through **outreach employees' own LinkedIn accounts**, connected via **Unipile**. An admin dashboard with **monthly payroll** already exists. We are adding:

1. **Applicant onboarding:** signup, TOS acceptance, personal/payroll details, WhatsApp OTP verification, LinkedIn connect via Unipile Hosted Auth, then submit for review.
2. **Admin review:** approve or reject applicants.
3. **Connection health monitoring:** detect LinkedIn disconnects, send WhatsApp nudges via **Baileys** with a reconnect link, escalate to admins, and track uptime.
4. **Supporting admin tooling:** team status board, employee detail with uptime, TOS versioning, settings, audit log.

Non-goals: building outreach campaigns, sending LinkedIn messages, redesigning payroll.

---

## 1. Stack & conventions

**Defaults.** Adapt these to the existing dashboard if it differs; ask first.

- **Web:** Next.js (App Router) + TypeScript (strict), server actions/route handlers.
- **DB:** PostgreSQL + Prisma.
- **Jobs:** `pg-boss`, a Postgres-backed queue. This avoids adding Redis.
- **Worker:** a separate long-running Node process (`apps/worker` or `src/worker/index.ts`) that hosts:
  - the Baileys client,
  - pg-boss job handlers,
  - the reconciler cron.
  - It **must not** run on serverless.
- **WhatsApp:** `baileys`, the WhiskeySockets package. Pin the exact version.
- **Email:** Resend or SMTP via Nodemailer, behind the notifier interface.
- **Validation:** zod at every boundary: forms, webhooks, env.
- **Auth:** reuse existing dashboard auth if present. Otherwise use Auth.js (credentials + email OTP) with a `role` on the user.
- **Time:** store UTC (`timestamptz`) and display in `Asia/Kolkata`. Quiet hours are evaluated in `Asia/Kolkata`.
- **Phones:** E.164 everywhere, parsed with `libphonenumber-js`. Default region IN.
- **Testing:** Vitest for unit tests, Playwright for one end-to-end happy path per flow.

**Code organisation:**

```
src/
  lib/unipile/        # ONLY place that calls Unipile (client, types, status mapping)
  lib/notify/         # Notifier interface + providers (baileys, email, [cloudapi later])
  lib/crypto/         # field encryption helpers
  lib/audit/          # audit log writer
  lib/monitoring/     # status normalisation, incident state machine, uptime
  app/(public)/apply/ # applicant flow
  app/(employee)/     # employee portal
  app/admin/          # admin screens
  app/api/webhooks/unipile/  # account status webhook
  app/api/unipile/notify/    # hosted-auth notify_url
  app/r/[token]/      # reconnect redirect
worker/
  index.ts            # boots Baileys + pg-boss + crons
  jobs/*.ts
```

---

## 2. Environment variables

Validate all of these with zod at boot and fail fast if any is missing.

```
DATABASE_URL=
APP_BASE_URL=https://dashboard.example.com
UNIPILE_DSN=apiXX.unipile.com:XXXXX        # from Unipile dashboard
UNIPILE_API_KEY=
UNIPILE_WEBHOOK_SECRET=                    # random 32+ chars; sent by Unipile as a header we configure
UNIPILE_NOTIFY_SECRET=                     # random; appended as ?s= to notify_url
FIELD_ENCRYPTION_KEY=                      # 32 bytes base64, AES-256-GCM
RECONNECT_TOKEN_SECRET=                    # HMAC key for /r/<token>
EMAIL_FROM=
RESEND_API_KEY=                            # or SMTP_* vars
ADMIN_ALERT_EMAILS=a@x.com,b@x.com
UNIPILE_FAKE=false                         # true = use the fake Unipile client (§12)
WA_DISABLED=false                          # true = WhatsApp sends are logged, not sent (dev)
```

---

## 3. Data model (Prisma)

Names are indicative; keep them consistent with the existing schema.

```prisma
enum Role { APPLICANT EMPLOYEE REVIEWER SUPER_ADMIN }

enum PersonStatus { DRAFT PENDING_REVIEW ACTIVE REJECTED SUSPENDED OFFBOARDED }

enum LinkStatus {     // our normalised view of a Unipile account
  CONNECTED
  CONNECTING
  NEEDS_RECONNECT     // CREDENTIALS / STOPPED, or ERROR past grace
  TRANSIENT_ERROR     // ERROR within grace window
  DELETED
}

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String?
  role          Role     @default(APPLICANT)
  createdAt     DateTime @default(now())
  person        Person?
}

model Person {
  id                 String       @id @default(cuid())
  userId             String       @unique
  user               User         @relation(fields: [userId], references: [id])
  status             PersonStatus @default(DRAFT)
  onboardingStep     Int          @default(0)   // 0 account,1 tos,2 details,3 linkedin,4 submitted
  fullName           String?
  mobileE164         String?
  whatsappE164       String?
  whatsappVerifiedAt DateTime?
  addressLine1       String?
  addressLine2       String?
  city               String?
  state              String?
  pincode            String?
  panEnc             String?      // encrypted (lib/crypto)
  bankAccountEnc     String?      // encrypted
  ifscEnc            String?      // encrypted
  upiIdEnc           String?      // encrypted
  submittedAt        DateTime?
  reviewedById       String?
  reviewedAt         DateTime?
  rejectionReason    String?
  activatedAt        DateTime?    // payroll start
  suspendedAt        DateTime?
  offboardedAt       DateTime?
  purgeAfter         DateTime?    // set on rejection (now + 30d)
  linkedin           LinkedInAccount?
  tosAcceptances     TosAcceptance[]
  incidents          Incident[]
  notifications      Notification[]
}

model LinkedInAccount {
  id               String     @id @default(cuid())
  personId         String     @unique
  person           Person     @relation(fields: [personId], references: [id])
  unipileAccountId String     @unique
  providerUserId   String?    @unique    // LinkedIn member id if Unipile exposes it; for duplicate detection
  displayName      String?
  profileUrl       String?
  status           LinkStatus @default(CONNECTING)
  lastRawStatus    String?
  lastStatusAt     DateTime?
  connectedAt      DateTime?
  events           ConnectionEvent[]
}

model ConnectionEvent {
  id          String   @id @default(cuid())
  accountId   String
  account     LinkedInAccount @relation(fields: [accountId], references: [id])
  rawStatus   String
  normalized  LinkStatus
  source      String   // "webhook" | "reconciler" | "notify_url" | "manual"
  payload     Json?
  receivedAt  DateTime @default(now())
  @@index([accountId, receivedAt])
}

model Incident {
  id            String    @id @default(cuid())
  personId      String
  person        Person    @relation(fields: [personId], references: [id])
  startedAt     DateTime
  resolvedAt    DateTime?
  cause         String    // raw Unipile status that opened it
  nudgeCount    Int       @default(0)
  escalatedAt   DateTime?
  lastNudgeAt   DateTime?
  @@index([personId, startedAt])
}

model Notification {
  id                String   @id @default(cuid())
  personId          String?
  person            Person?  @relation(fields: [personId], references: [id])
  incidentId        String?
  channel           String   // "whatsapp" | "email"
  templateKey       String
  toAddress         String
  body              String
  status            String   // "queued" | "sent" | "failed" | "deferred_quiet_hours" | "skipped"
  attempts          Int      @default(0)
  providerMessageId String?
  error             String?
  createdAt         DateTime @default(now())
  sentAt            DateTime?
}

model TosVersion {
  id          String   @id @default(cuid())
  version     Int      @unique
  contentMd   String
  contentHash String   // sha256 of contentMd
  publishedAt DateTime?
  publishedById String?
  isCurrent   Boolean  @default(false)  // exactly one true (enforce in tx)
}

model TosAcceptance {
  id          String   @id @default(cuid())
  personId    String
  person      Person   @relation(fields: [personId], references: [id])
  tosVersionId String
  acceptedAt  DateTime @default(now())
  ip          String
  userAgent   String
  @@unique([personId, tosVersionId])
}

model OtpCode {
  id         String   @id @default(cuid())
  phoneE164  String
  purpose    String   // "whatsapp_verify"
  codeHash   String   // sha256(code + pepper)
  expiresAt  DateTime
  attempts   Int      @default(0)
  consumedAt DateTime?
  createdAt  DateTime @default(now())
  @@index([phoneE164, createdAt])
}

model ReconnectToken {
  id         String   @id @default(cuid())   // random, put in URL
  personId   String
  incidentId String?
  expiresAt  DateTime
  usedAt     DateTime?                       // set when a Unipile link was minted from it
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?  // null = system
  action     String   // e.g. "person.approve", "tos.publish", "settings.update"
  targetType String
  targetId   String?
  metadata   Json?
  createdAt  DateTime @default(now())
  @@index([targetType, targetId])
}

model WaAuthState {   // Baileys creds + signal keys, encrypted
  key        String   @id     // "creds" or "<type>-<id>"
  valueEnc   String
  updatedAt  DateTime @updatedAt
}

model Setting {       // single-row-per-key config, admin editable
  key   String @id
  value Json
}
```

**Default `Setting` rows (seed):**

| key | default |
|---|---|
| `nudge.firstDelayMin` | 0 |
| `nudge.secondDelayMin` | 120 |
| `nudge.escalateAfterMin` | 1440 |
| `nudge.dailyReminderAfterEscalation` | true |
| `nudge.maxNudges` | 10 |
| `nudge.errorGraceMin` | 10 |
| `nudge.flapWindowMin` | 30 |
| `quietHours` | `{ "start": "22:00", "end": "08:00", "tz": "Asia/Kolkata" }` |
| `reconciler.intervalMin` | 15 |
| `retention.rejectedDays` | 30 |
| `reconnectToken.ttlHours` | 72 |

---

## 4. Unipile integration (`src/lib/unipile/`)

> **Verify every endpoint and payload shape against https://developer.unipile.com before implementing.** What follows is the expected shape. If reality differs, adapt `lib/unipile` only. Nothing outside that folder should know Unipile's wire format.

**Client.** Base URL `https://${UNIPILE_DSN}/api/v1`, header `X-API-KEY: ${UNIPILE_API_KEY}`, JSON. Every call gets a timeout, 3 retries with backoff on 5xx/network errors, and structured logging without secrets.

**Functions to expose:**

```ts
createHostedAuthLink(opts: {
  type: "create" | "reconnect";
  personId: string;              // sent as `name` so the notify callback can map back
  reconnectAccountId?: string;   // required when type = "reconnect"
  expiresInMin?: number;         // default 60
}): Promise<{ url: string }>
// POST /hosted/accounts/link
// body: { type, providers: ["LINKEDIN"], api_url: "https://"+DSN, expiresOn: ISO,
//         notify_url: `${APP_BASE_URL}/api/unipile/notify?s=${UNIPILE_NOTIFY_SECRET}`,
//         name: personId,
//         success_redirect_url: `${APP_BASE_URL}/apply/linkedin/done` (create) | `${APP_BASE_URL}/portal?reconnected=1` (reconnect),
//         failure_redirect_url: `${APP_BASE_URL}/apply/linkedin?error=1` | `${APP_BASE_URL}/portal?reconnect_error=1`,
//         reconnect_account: reconnectAccountId (reconnect only) }

getAccount(accountId: string): Promise<UnipileAccount>      // GET /accounts/{id}
listAccounts(): Promise<UnipileAccount[]>                    // GET /accounts (paginate with cursor until done)
deleteAccount(accountId: string): Promise<void>              // DELETE /accounts/{id}; treat 404 as success
ensureAccountStatusWebhook(): Promise<void>
// idempotent: list webhooks; if none with source "account_status" pointing at our URL, create one:
// POST /webhooks { source: "account_status", request_url: `${APP_BASE_URL}/api/webhooks/unipile`,
//                  name: "account-status", headers: [{ key: "x-webhook-secret", value: UNIPILE_WEBHOOK_SECRET }] }
// Run on worker boot.
```

**Status extraction:** an account's current status comes from its `sources[].status`, or the equivalent field. Write `extractRawStatus(account)` in one place.

**Normalisation** (`lib/monitoring/normalize.ts`):

| Raw | Normalised |
|---|---|
| `OK`, `CREATION_SUCCESS`, `RECONNECTED`, `SYNC_SUCCESS` | `CONNECTED` |
| `CONNECTING` | `CONNECTING` |
| `CREDENTIALS`, `STOPPED` | `NEEDS_RECONNECT` |
| `ERROR` | `TRANSIENT_ERROR`. This is promoted to `NEEDS_RECONNECT` by the state machine after `errorGraceMin`. |
| `DELETED` | `DELETED` |
| unknown | log a warning and treat as `TRANSIENT_ERROR` |

**Endpoints we host:**

1. `POST /api/unipile/notify?s=…` is the hosted-auth callback.
   - Reject unless `s === UNIPILE_NOTIFY_SECRET` (constant-time compare).
   - Body is expected to be `{ status: "CREATION_SUCCESS" | "RECONNECTED", account_id, name }`.
   - **Do not trust the body.** Call `getAccount(account_id)` to confirm it exists, then:
     - `name` → `personId`. That person must exist and be at `onboardingStep >= 3` (create), or have this `unipileAccountId` (reconnect).
     - **Duplicate check:** if `providerUserId` (or `profileUrl`) matches another person's `LinkedInAccount`:
       1. `deleteAccount(account_id)`
       2. Mark the applicant's step as failed with `duplicate_linkedin`.
       3. Write an audit entry.
       4. Stop.
     - Upsert the `LinkedInAccount`: status `CONNECTED`, `connectedAt`, `displayName`, `profileUrl`.
     - Write a `ConnectionEvent` with source `notify_url`.
     - Call `applyStatus()` (§6).
   - Return 200 quickly. Do the work inline, but keep it under 5s; otherwise enqueue it.
2. `POST /api/webhooks/unipile` is the account-status webhook.
   - Reject unless header `x-webhook-secret` matches.
   - Parse with zod. Expected shape: `{ AccountStatus: { account_id, account_type, message } }`. Accept unknown extra fields.
   - Ignore `account_type !== "LINKEDIN"`.
   - Look up the `LinkedInAccount` by `unipileAccountId`. If it's unknown, log and return 200.
   - Write a `ConnectionEvent` with source `webhook`, then call `applyStatus(accountId, rawStatus, "webhook")`.
   - Always return 200 unless the auth check fails, so Unipile doesn't retry-storm.

---

## 5. Notifier (`src/lib/notify/`)

```ts
interface NotifyProvider {
  channel: "whatsapp" | "email";
  isHealthy(): Promise<boolean>;
  send(to: string, body: string): Promise<{ providerMessageId?: string }>;
}

notify(personId: string, templateKey: TemplateKey, vars: Record<string,string>,
       opts?: { incidentId?: string; bypassQuietHours?: boolean; channels?: ("whatsapp"|"email")[] })
```

**`notify()` behaviour:**

1. Render the template, which is plain text and short.
2. **Quiet hours:**
   - Applies only to employee-facing templates that aren't `bypassQuietHours`. OTPs and admin alerts bypass it.
   - If now falls inside quiet hours, write a `Notification` with status `deferred_quiet_hours`.
   - Schedule a pg-boss job at the next quiet-hours end.
   - Return.
3. Try WhatsApp: write a `Notification` row as `queued`, then enqueue the `send-whatsapp` job.
4. If the WhatsApp provider is unhealthy, or the job fails after 3 attempts, send the same body by email. That's a second `Notification` row, which references the first in `error`.
5. Respect the `WA_DISABLED` flag: log the message and mark it `skipped`.

**Templates** (keep them in one file so the wording is easy to edit). `{link}` is always `${APP_BASE_URL}/r/<token>`.

| key | text (draft) |
|---|---|
| `otp` | `Your verification code is {code}. It expires in 10 minutes.` |
| `nudge_1` | `Hi {firstName}, your LinkedIn got disconnected from the outreach system. Please reconnect here (takes 1 min): {link}` |
| `nudge_2` | `Reminder {firstName}: your LinkedIn is still disconnected. Reconnect here: {link}` |
| `nudge_final` | `{firstName}, your LinkedIn has been disconnected for 24 hours and the admin has been notified. Reconnect: {link}` |
| `nudge_daily` | `Your LinkedIn is still disconnected. Reconnect: {link}` |
| `reconnected` | `Thanks {firstName}, your LinkedIn is connected again.` |
| `approved` | `Welcome aboard, {firstName}! Your application is approved. Log in: {portalLink}` |
| `rejected` | `Hi {firstName}, thanks for applying. We're not moving forward right now.` |
| `tos_updated` | `Our Terms of Service have been updated. Please review and accept: {portalLink}` |
| `admin_escalation` | `[Admin] {fullName} ({phone}) has been disconnected since {since}. {adminLink}` |
| `admin_wa_down` | `[Admin] WhatsApp sender is logged out. Re-link it: {settingsLink}` (email only) |
| `admin_worker_silent` | `[Admin] Worker heartbeat missing for 30 min.` (email only) |

### 5.1 Baileys provider (runs only in the worker)

- **Auth state:** implement a DB-backed version of Baileys' auth state, equivalent to `useMultiFileAuthState` but reading and writing `WaAuthState` rows. Values are JSON serialised with Baileys' `BufferJSON` replacer/reviver, then encrypted with `lib/crypto`.
  - **Do not** use the file-based helper in production.
- **Connection lifecycle:**
  - Listen to `connection.update`.
  - On `qr`, store the latest QR string in memory and in `Setting['wa.pendingQr']` with a timestamp, so the admin settings page can render it.
  - Support a pairing-code alternative if Baileys exposes one in the pinned version.
  - On `open`, set `Setting['wa.status'] = 'connected'` and clear the QR.
  - On `close`:
    - If the reason is logged out (`DisconnectReason.loggedOut`): set the status to `logged_out`, clear the auth state, and email `admin_wa_down`.
    - Otherwise, reconnect with exponential backoff (1s → 60s max) and set the status to `reconnecting`.
- **Sending:**
  - JID = `${digitsOnly(e164)}@s.whatsapp.net`.
  - Before the first send to a number, check `sock.onWhatsApp(jid)` and cache the result on `Person`.
  - Rate limit: one message at a time, a random 5–15 s gap, max 30/hour. Excess messages wait in the queue.
- **Health:** `isHealthy()` returns true only when the status is `connected`.
- **Admin control endpoints** go through the DB, not direct process calls:
  - The web app sets `Setting['wa.command'] = 'relink' | 'logout'`.
  - The worker polls every 5s, acts on the command, and clears it.

### 5.2 Email provider

Use Resend or SMTP. `isHealthy()` returns true. It's used for fallback and admin alerts.

### 5.3 Future: `CloudApiProvider`

Leave a stub that throws "not implemented", plus a comment on what's needed: template names and a phone number ID.

---

## 6. Monitoring state machine (`src/lib/monitoring/`)

Single entry point:

```ts
applyStatus(linkedinAccountId: string, rawStatus: string, source: "webhook"|"reconciler"|"notify_url"|"manual"): Promise<void>
```

The whole function runs inside a transaction holding `SELECT … FOR UPDATE` on the `LinkedInAccount` row, so concurrent webhook and reconciler calls serialise.

**Steps:**

1. `next = normalize(rawStatus)`. Update `status`, `lastRawStatus`, and `lastStatusAt`.
   - If `next` and `lastRawStatus` are unchanged, and source is `reconciler`, return early. This is the idempotency guard.
2. Look up the person.
   - If the person is not `ACTIVE`, record the status only.
   - No incidents or nudges for applicants. Exception: if a `PENDING_REVIEW` applicant drops, show it on their application card.
3. Let `open` be the person's incident with `resolvedAt = null`.
4. **Transitions:**

| next | open incident? | action |
|---|---|---|
| `CONNECTED` | yes | `resolvedAt = now`; cancel the incident's scheduled jobs (pg-boss `singletonKey` = `incident:<id>:*`); notify `reconnected`; audit `incident.resolve` |
| `CONNECTED` | no | nothing |
| `CONNECTING` | any | nothing |
| `TRANSIENT_ERROR` | no | Open an incident with `cause = rawStatus`. Schedule `promote-error` at now + `errorGraceMin`. No nudge yet. |
| `TRANSIENT_ERROR` | yes | nothing |
| `NEEDS_RECONNECT` | no | **Flap check:** if the latest resolved incident has `resolvedAt` within `flapWindowMin`, reopen it (`resolvedAt = null`) and do not restart the ladder; schedule the next rung based on its `nudgeCount`. Otherwise, open a new incident and schedule `nudge` rung 1 at now + `firstDelayMin`. |
| `NEEDS_RECONNECT` | yes, opened as transient | Schedule rung 1 now if no nudge has been sent yet. |
| `NEEDS_RECONNECT` | yes, already nudging | nothing |
| `DELETED` | any | Resolve any open incident; audit `linkedin.deleted_externally`; create an admin dashboard flag. |

**Jobs** (pg-boss; each gets `singletonKey` `incident:<id>:<rung>` so it can't duplicate):

- **`promote-error(incidentId)`:**
  - Re-read the account.
  - If it's still `TRANSIENT_ERROR`, fetch the live status via `getAccount`.
    - If still `ERROR`, set `NEEDS_RECONNECT` and schedule rung 1 now.
    - If `OK`, resolve the incident.
- **`nudge(incidentId, rung)`:**
  - Re-check that the incident is open and the account is not `CONNECTED`. If it is connected, return.
  - Mint a `ReconnectToken` with a TTL.
  - Send by rung:
    - rung 1: `nudge_1`.
    - rung 2: `nudge_2`.
    - Escalation rung: `nudge_final` to the employee, plus `admin_escalation` to every SUPER_ADMIN and REVIEWER (WhatsApp, with email fallback, bypassing quiet hours). Set `escalatedAt`.
    - Daily rungs: `nudge_daily`.
  - Increment `nudgeCount` and set `lastNudgeAt`.
  - Schedule the next rung:
    - Rung 1 → rung 2 at `startedAt + secondDelayMin`.
    - Rung 2 → escalation at `startedAt + escalateAfterMin`.
    - Escalation → daily, every 24h if enabled.
  - Stop at `maxNudges`.

**Uptime** (`uptime.ts`):

```ts
monthlyUptime(personId, year, month): { activeSeconds, downSeconds, uptimePct }
```

- The active window is [max(month start, `activatedAt`), min(month end, now, `offboardedAt`)], minus suspended spans if they're tracked.
- `downSeconds` is the sum of incident durations clipped to that window. Open incidents run to now.
- Expose this as an internal function for payroll. **Do not** change pay logic.

---

## 7. Reconciler (worker cron, every `reconciler.intervalMin`)

1. `listAccounts()` from Unipile.
2. For each local `LinkedInAccount` whose person is `PENDING_REVIEW | ACTIVE | SUSPENDED`:
   - Find the matching remote account. If it's missing remotely, treat it as `DELETED`.
   - If the remote raw status differs from `lastRawStatus`, write a `ConnectionEvent` (source `reconciler`) and call `applyStatus`.
3. Remote LINKEDIN accounts with no local match: log them and show a count on the admin dashboard as **"orphan Unipile accounts"**. These cost money. **Do not auto-delete.**
4. Write `Setting['worker.heartbeat'] = now` on every run.

A separate **heartbeat watchdog** runs in the web app via a lightweight cron, or an uptime pinger hitting `/api/health/worker`. If the heartbeat is older than 30 min, email `admin_worker_silent`, at most once per hour.

---

## 8. Applicant flow (`/apply/*`)

Server-side guards: each page redirects to the person's current `onboardingStep` if they try to skip ahead. All forms use zod validation with server-side checks.

| Step | Route | Behaviour |
|---|---|---|
| 0 | `/apply` | Sign up with email + password (min 10 chars), or email OTP. Creates `User(role=APPLICANT)` and `Person(status=DRAFT)`. Rate-limited. |
| 1 | `/apply/terms` | Render the current `TosVersion.contentMd`. Unticked checkbox "I have read and agree to the Terms of Service (v{n})". The button stays disabled until it's ticked. On submit, insert `TosAcceptance` with `ip` (from `x-forwarded-for`, first hop) and `userAgent`; set step = 2. |
| 2 | `/apply/details` | Fields: fullName, mobile, WhatsApp (checkbox "same as mobile"), address (line1, line2, city, state, pincode), PAN, payment method (bank + IFSC, or UPI). **The fields are configurable via a const; confirm the final list with the business.** Encrypt PAN, bank, IFSC and UPI. **WhatsApp OTP:** a "Send code" button checks `onWhatsApp` via a worker RPC (DB command row + poll, or a small internal HTTP endpoint on the worker), then sends a 6-digit code (template `otp`) with a 10-min expiry, max 5 attempts, and max 3 sends per hour per number. Verifying sets `whatsappVerifiedAt`. The page can't be submitted until the number is verified. |
| 3 | `/apply/linkedin` | Explains what connecting means, with a link to the relevant TOS section. Button → server action `createHostedAuthLink({type:"create", personId})` → redirect. `/apply/linkedin/done` polls `GET /api/me/linkedin-status` every 2s for up to 60s until the `LinkedInAccount` exists. **Note:** the success redirect can arrive before or after the notify callback; handle both orders. On `duplicate_linkedin`, show an error. When it's done, set step = 4. |
| 4 | `/apply/review` | A read-only summary with a Submit button. On submit: status = `PENDING_REVIEW`, `submittedAt`; audit; notify admins (email digest is fine). |
| — | `/apply/status` | Shows the current status. A rejected applicant sees the generic message, not the reason, unless the business decides otherwise. |

**If an applicant's LinkedIn drops while they're pending:** show it on their status page with a reconnect button. Send no WhatsApp nudges.

---

## 9. Admin review (`/admin/applications`)

- **List view:** `PENDING_REVIEW`, oldest first, with filters for status.
- **Detail view:** all fields, with encrypted fields masked (`XXXX1234`) and a "reveal" button for SUPER_ADMIN only. Each reveal is audited. Also shows:
  - LinkedIn display name and profile link, and live link status
  - TOS version accepted and when
  - WhatsApp verified timestamp
- **Approve** (REVIEWER+), in one transaction:
  1. status = `ACTIVE`, `activatedAt = now`, `reviewedById`/`reviewedAt`, `user.role = EMPLOYEE`.
  2. Call the **payroll hook** `onEmployeeActivated(personId, activatedAt)`. This is a stub/adapter into the existing payroll module; ask how it should integrate.
  3. Audit, then notify `approved`.
  4. Run `applyStatus` with the current status. If the account is already disconnected, an incident starts now.
- **Reject** (REVIEWER+), with a reason required (internal):
  1. Set status = `REJECTED` and `purgeAfter = now + retention.rejectedDays`.
  2. `deleteAccount(unipileAccountId)`, retrying via a job if it fails.
  3. Audit, then notify `rejected`.

---

## 10. Employee lifecycle & portal

- **Portal** (`/portal`):
  - Status card with a big "Reconnect LinkedIn" button when not `CONNECTED`. The button calls the same server action as `/r/[token]`.
  - Existing payroll view.
  - Accepted TOS (view the version they accepted).
- **TOS gate:** if the current TOS version is newer than the person's latest acceptance, every employee page redirects to `/portal/terms` until they re-accept.
  - The gate is UI only. It **does not** affect LinkedIn monitoring or nudges.
- **`/r/[token]`:**
  - Look up `ReconnectToken`. Reject (with a friendly page) if it's missing, expired, or the person isn't `ACTIVE`/`PENDING_REVIEW`.
  - If the account is already `CONNECTED`, show "You're already connected ✓".
  - Otherwise call `createHostedAuthLink({type:"reconnect", personId, reconnectAccountId})`, set `usedAt`, and issue a 302 to the Unipile URL.
  - The token may be reused until expiry; each use mints a fresh Unipile link.
  - No login is required: the token is the credential. It's single-person, long random (≥128-bit), and only lets that person reconnect their own account.
- **Suspend:** status `SUSPENDED`; cancel nudge jobs; keep monitoring and recording; no nudges. Audit.
- **Reactivate:** status back to `ACTIVE`; run `applyStatus` with the current status.
- **Offboard** (SUPER_ADMIN):
  1. Set status `OFFBOARDED`, `offboardedAt`.
  2. Resolve any open incident and cancel its jobs.
  3. `deleteAccount` in Unipile.
  4. Call the payroll hook `onEmployeeOffboarded`.
  5. Audit.
  - Data is retained per the retention policy (open decision; leave as a setting with no purge by default).

---

## 11. Admin screens

| Route | Role | Content |
|---|---|---|
| `/admin/team` | REVIEWER+ | Table of ACTIVE + SUSPENDED people, with columns: name, WhatsApp, link status badge, "down for" duration, nudges sent, escalated?, uptime % this month. Sort: escalated → needs reconnect → transient → connected. Auto-refresh every 30s. Header counters: connected / disconnected / escalated / orphan Unipile accounts / WhatsApp sender status. |
| `/admin/people/[id]` | REVIEWER+ | Profile (masked), status actions (suspend, reactivate, offboard [SUPER_ADMIN], send nudge now), uptime for the current and previous month, incident list (start, end, duration, cause, nudges), notification log, connection event log (last 100), audit entries for this person. |
| `/admin/applications` | REVIEWER+ | §9 |
| `/admin/tos` | SUPER_ADMIN | Version list. Create a draft (markdown editor + preview). **Publish** sets `isCurrent`, records `publishedAt`, audits, and sends `tos_updated` to all ACTIVE employees. A published version is immutable. |
| `/admin/settings` | SUPER_ADMIN | Edit the `Setting` keys from §3 with validation. WhatsApp panel: status, QR render (`qrcode` lib) when pending, "Re-link" and "Log out" buttons, last sent time, messages in the last hour. Audit every change. |
| `/admin/audit` | SUPER_ADMIN | Paginated, filterable audit log. |

---

## 12. Fake Unipile mode (`UNIPILE_FAKE=true`)

This is required for development and tests.

- `lib/unipile` swaps in an in-memory/DB fake implementing the same interface.
- `createHostedAuthLink` returns `${APP_BASE_URL}/dev/fake-unipile?…`. That page has "Succeed" and "Fail" buttons; Succeed creates a fake account and calls our `notify_url` the same way Unipile would.
- `/dev/unipile-console` (dev only) lists fake accounts and offers buttons to fire any raw status (`OK`, `CREDENTIALS`, `ERROR`, `STOPPED`, `CONNECTING`, `DELETED`) through the real webhook endpoint, with the correct secret header.
- The dev routes return 404 when `NODE_ENV=production`.

Also add a **time-travel helper for tests**: inject a clock into the monitoring module so a test can advance time and run due jobs synchronously.

---

## 13. Security & privacy requirements

- **Field encryption:** AES-256-GCM with a random 12-byte IV per value; store `base64(iv|tag|ciphertext)`. Key from `FIELD_ENCRYPTION_KEY`. Write a `rotateKey` script stub.
- **RBAC:** check the role in every server action and route handler with a shared `requireRole()`. Never rely on hiding UI alone.
- **Rate limits:** login, signup, OTP send/verify, `/r/[token]`, webhook endpoints. A Postgres-backed or in-memory limiter is fine.
- **Secrets** are never logged. Phone numbers are logged masked.
- **Retention jobs** (daily):
  - Hard-delete `REJECTED` people past `purgeAfter`, including their Person, OTPs, notifications and tokens. Keep a minimal audit entry `person.purged` with no PII.
  - Delete consumed or expired OTPs older than 7 days and expired reconnect tokens.
  - Summarise or delete `ConnectionEvent` rows older than 12 months.
- **Audit** these actions: approve, reject, suspend, reactivate, offboard, PII reveal, TOS publish, settings change, manual nudge, WhatsApp relink/logout, incident resolve, `linkedin.deleted_externally`, duplicate LinkedIn blocked.
- **CSRF:** use the framework defaults. Cookies are `httpOnly`, `secure`, and `sameSite=lax`.

---

## 14. Milestones

Do these in order. Each one ends with its tests passing and a short note in `docs/PROGRESS.md`.

1. **Foundations:** Prisma schema + migrations, seed (settings, TOS v1 placeholder, one SUPER_ADMIN from env), env validation, `requireRole`, audit writer, crypto helpers with unit tests.
2. **Worker + notifier:** worker process, pg-boss, Baileys provider with DB auth state, email provider, `notify()` with quiet hours and fallback, admin settings WhatsApp panel (QR / status / relink), heartbeat + watchdog. Test: send a test message from settings.
3. **Applicant flow:** §8 end-to-end with `UNIPILE_FAKE=true`, then smoke-test once against real Unipile.
4. **Admin review:** §9, the payroll hook stubs, the rejection purge job.
5. **Monitoring:** webhook + notify endpoints, `ensureAccountStatusWebhook`, `applyStatus`, all jobs, reconciler, `/r/[token]`, uptime. Unit-test every row of the §6 transition table with the fake clock.
6. **Admin & employee screens:** §10 and §11, TOS versioning + gate.
7. **Hardening:** rate limits, retention jobs, the failure checklist (§15), a Playwright happy path for apply → approve → disconnect → nudge → reconnect.

---

## 15. Failure-case checklist (must be handled and tested)

- [ ] The webhook arrives twice: no duplicate incident or nudge.
- [ ] A webhook is missed: the reconciler opens the incident within one interval.
- [ ] Webhook and reconciler run at the same moment: the row lock serialises them.
- [ ] `ERROR` that self-heals within the grace period: no nudge sent, incident resolved.
- [ ] Reconnect then drop within the flap window: the same incident is reopened and the ladder isn't restarted.
- [ ] The person reconnects before a scheduled nudge fires: the nudge job sees `CONNECTED` and exits; jobs are cancelled.
- [ ] A nudge falls in quiet hours: deferred to 08:00 IST; it's skipped if they reconnected meanwhile.
- [ ] The WhatsApp sender is logged out: email fallback is used and admins get an email.
- [ ] A reconnect token is opened after the person already reconnected: friendly "already connected" page.
- [ ] An expired or unknown token: friendly page, no info leak.
- [ ] The notify callback arrives before or after the browser redirect: both work.
- [ ] Notify is called with a forged body: rejected by the secret, or by the `getAccount` check.
- [ ] The same LinkedIn is connected by two applicants: the second is blocked and its Unipile account deleted.
- [ ] A rejected applicant: Unipile account deleted (retried on failure), data purged after 30 days.
- [ ] TOS republished: employees are gated in the UI, monitoring is unaffected.
- [ ] Worker down for 30+ min: watchdog email.
- [ ] Unipile API down: client retries; the reconciler logs and continues next interval without false-positive incidents. **A failed `listAccounts` must not mark accounts as DELETED.**

---

## 16. Open decisions

Implement the default shown, but keep it easy to change. Record the final answers in `docs/DECISIONS.md`.

| # | Question | Default in this spec |
|---|---|---|
| D1 | Connect LinkedIn before or after admin approval? | Before (step 3). Keep the step order in one config array so it can move after approval. |
| D2 | How does uptime affect pay? | Not implemented; `monthlyUptime()` is exposed only. |
| D3 | Final list of payroll/personal fields | As in §8; configurable const. |
| D4 | Retention period for offboarded employees | No auto-purge; a setting exists. |
| D5 | Nudge timings / quiet hours | §3 defaults. |
| D6 | Show the rejection reason to the applicant? | No. |
| D7 | WhatsApp provider long-term | Baileys now, Cloud API provider stub ready. |
| D8 | Payroll integration shape | Stub hooks `onEmployeeActivated` / `onEmployeeOffboarded`; ask before wiring. |
