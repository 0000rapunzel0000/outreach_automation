# Progress

All seven milestones (§14) are built against `UNIPILE_FAKE=true`. Nothing has run against real Unipile or a real WhatsApp number yet.

| Milestone | Status | Notes |
|---|---|---|
| 1. Foundations | Done | Prisma schema + migration, seed (settings, TOS v1 placeholder, SUPER_ADMIN from env), zod env, `requireRole`, audit writer, AES-256-GCM helpers with tests. |
| 2. Worker + notifier | Done | Worker (advisory-lock singleton), pg-boss, Baileys with DB-backed encrypted auth state, QR and pairing-code relink, email (Resend or SMTP), `notify()` with quiet hours and WhatsApp → email fallback, hourly cap, heartbeat + `/api/health/worker` watchdog. Not tested with a real phone. |
| 3. Applicant flow | Done | Clicked through in a browser with fake Unipile: signup → TOS → OTP → details → LinkedIn → submit. Real Unipile smoke test still to do. |
| 4. Admin review | Done | Approve / reject, payroll hook stubs, Unipile delete with retry job, 30-day purge. |
| 5. Monitoring | Done | Webhook + notify endpoints, `ensureAccountStatusWebhook`, `applyStatus` under a row lock, promote-error / nudge jobs, reconciler, `/r/<token>`, uptime. Every §6 transition row is unit-tested with the fake clock. |
| 6. Screens | Done | Team board, person detail, applications, TOS versions + gate, settings + WhatsApp panel, audit log, employee portal. |
| 7. Hardening | Done | Rate limits, retention job, the §15 checklist in unit tests (81 passing), and the Playwright happy path (apply → approve → disconnect → nudge → reconnect → "already connected") passing in about 15 s. It caught a real bug: the LinkedIn done page could get stuck when two status polls triggered overlapping navigations. |

## Still to do before going live
- Smoke-test against real Unipile (`UNIPILE_FAKE=false`), and check the webhook payload from a real disconnect.
- Link a dedicated WhatsApp SIM in Admin → Settings and send a test message.
- Replace the TOS v1 placeholder with lawyer-approved text.
- Wire the payroll hooks (D8).
- Point an uptime pinger at `/api/health/worker`.
