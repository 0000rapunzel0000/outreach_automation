# Outreach Team Platform

Applicant onboarding, admin review and LinkedIn connection monitoring for an outreach team whose LinkedIn accounts are connected through Unipile. `SPEC.md` is the build spec. `docs/DECISIONS.md` lists where this differs from it. `docs/PROGRESS.md` shows what's done.

## Two processes, one database

- **Web** (`npm run dev` / `npm start`): Next.js. All pages, the Unipile webhook and notify endpoints, and `/r/<token>` reconnect links. Can run on serverless.
- **Worker** (`npm run worker`): long-running Node. Holds the Baileys WhatsApp session and runs the pg-boss jobs (message delivery, nudge ladder, promote-error, Unipile deletes) plus the reconciler (every 15 min) and the retention job (03:00 IST). **Not serverless.** Only one may run at a time; a second instance exits.

They coordinate through Postgres: the web app enqueues jobs, and admin WhatsApp commands and the onWhatsApp check go through DB rows the worker polls.

## Local setup

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in `.env` (the comments say how to generate each secret). For local work keep `UNIPILE_FAKE=true`, `WA_DISABLED=true` and `EMAIL_DISABLED=true`, and set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

```bash
createdb outreach_dev
```

```bash
npx prisma migrate deploy && npm run db:seed
```

Run the web app and the worker in two terminals:

```bash
npm run dev
```

```bash
npm run worker:dev
```

Then open http://localhost:3000/apply to apply, and http://localhost:3000/login as the seeded admin.

## Fake Unipile (dev)

With `UNIPILE_FAKE=true`, "Connect LinkedIn" opens `/dev/fake-unipile` (Succeed / Fail). `/dev/unipile-console` lists the fake accounts and lets you:
- fire any status (OK, CREDENTIALS, ERROR, STOPPED, CONNECTING, DELETED) through the real webhook endpoint,
- change a status silently, to test that the reconciler catches a missed webhook,
- simulate a Unipile API outage.

With `WA_DISABLED=true` WhatsApp messages are logged by the worker instead of sent, and the OTP is shown on the details page.

## Tests

```bash
createdb outreach_test
```

```bash
npm test
```

The unit tests (Vitest) cover every row of the §6 transition table and the §15 failure checklist with a fake clock and an in-memory queue, plus the real pg-boss adapter. They use `outreach_test` (override with `TEST_DATABASE_URL`).

The end-to-end happy path (Playwright) needs a browser once:

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

## Going live

1. `UNIPILE_FAKE=false` with a real `UNIPILE_DSN` / `UNIPILE_API_KEY`. The worker registers the `account_status` webhook on boot, so `APP_BASE_URL` must be publicly reachable over HTTPS.
2. `WA_DISABLED=false`, start the worker, open Admin → Settings and scan the QR code with the **dedicated** WhatsApp SIM. Send yourself a test message.
3. Configure Resend or SMTP and set `EMAIL_DISABLED=false`.
4. Replace the TOS placeholder (Admin → Terms → New draft → Publish).
5. Point an uptime pinger at `GET /api/health/worker`. It returns 503 and emails admins when the worker has been silent for 30 minutes.
6. Rotate the field-encryption key with `npm run rotate-key` (see the script header).
