import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// §14 M7: apply -> approve -> disconnect -> nudge -> reconnect, against fake Unipile with WhatsApp disabled.
const db = new PrismaClient();
const stamp = Date.now();
const applicant = { email: `e2e-${stamp}@example.test`, password: `e2e-pass-${stamp}` };
const admin = { email: process.env.SEED_ADMIN_EMAIL!, password: process.env.SEED_ADMIN_PASSWORD! };

test.afterAll(() => db.$disconnect());

async function logout(page: Page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL("**/login");
}

test("apply, approve, disconnect, nudge, reconnect", async ({ page }) => {
  test.skip(!admin.email || !admin.password, "set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD");

  // 1. Account
  await page.goto("/apply");
  await page.getByLabel("Email").fill(applicant.email);
  await page.getByLabel("Password (at least 10 characters)").fill(applicant.password);
  await page.getByLabel("Confirm password").fill(applicant.password);
  await page.getByRole("button", { name: "Create account" }).click();

  // 2. Terms: the button is disabled until the box is ticked.
  const agree = page.getByRole("button", { name: "Agree and continue" });
  await expect(agree).toBeDisabled();
  await page.getByLabel(/I have read and agree/).check();
  await agree.click();

  // 3. Details + WhatsApp OTP (WA_DISABLED shows the code on the page in dev)
  const phone = `+9198${String(stamp).slice(-8)}`;
  await page.locator('input[name="whatsapp"]').first().fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  const code = (await page.getByText(/your code is \d{6}/).innerText()).match(/\d{6}/)![0];
  await page.locator('input[name="code"]').fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("WhatsApp number verified.")).toBeVisible();
  await page.getByLabel("Full name (as on PAN)").fill("E2E Tester");
  await page.getByLabel("Address line 1").fill("1 Test Street");
  await page.getByLabel("City").fill("Pune");
  await page.getByLabel("State").fill("Maharashtra");
  await page.getByLabel("PIN code").fill("411001");
  await page.getByLabel("PAN", { exact: true }).fill("ABCDE1234F");
  await page.getByLabel("Bank account number").fill("123456789012");
  await page.getByLabel("IFSC").fill("HDFC0001234");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 4. LinkedIn via fake hosted auth
  await page.getByRole("button", { name: "Connect LinkedIn" }).click();
  await page.getByLabel(/LinkedIn identity/).fill(`e2e-${stamp}`);
  await page.getByRole("button", { name: "Succeed" }).click();
  await page.waitForURL("**/apply/review");

  // 5. Submit
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText("Pending review")).toBeVisible();
  await logout(page);

  // Admin approves
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/admin/team");
  await page.goto("/admin/applications");
  await page.locator("tr", { hasText: applicant.email }).getByRole("link", { name: "E2E Tester" }).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/Approved/)).toBeVisible();

  // Disconnect through the real webhook endpoint
  const person = await db.person.findFirstOrThrow({ where: { user: { email: applicant.email } }, include: { linkedin: true } });
  await page.goto("/dev/unipile-console");
  await page.locator("tr", { hasText: person.linkedin!.unipileAccountId }).getByRole("button", { name: "Fire CREDENTIALS" }).click();
  await expect.poll(async () => (await db.incident.count({ where: { personId: person.id, resolvedAt: null } })), { timeout: 15_000 }).toBe(1);

  // Nudge now (the ladder's nudge may be deferred by quiet hours; this bypasses them)
  await page.goto(`/admin/people/${person.id}`);
  await page.getByRole("button", { name: "Send nudge now" }).click();
  // WA_DISABLED: the worker marks it skipped but the row keeps the body, which has the link.
  const nudgeBody = async () => (await db.notification.findFirst({ where: { personId: person.id, templateKey: "nudge_2", status: "skipped" } }))?.body;
  await expect.poll(nudgeBody, { timeout: 20_000 }).toBeTruthy();
  const link = (await nudgeBody())!.match(/https?:\/\/\S+\/r\/[A-Za-z0-9_-]+/)![0];
  await logout(page);

  // Employee taps the WhatsApp link (not logged in) and reconnects
  await page.goto(link);
  await page.getByRole("button", { name: "Succeed" }).click();
  await expect(page.getByText("Thanks, you're reconnected")).toBeVisible();
  await expect.poll(async () => (await db.incident.count({ where: { personId: person.id, resolvedAt: null } })), { timeout: 15_000 }).toBe(0);
  const acct = await db.linkedInAccount.findUniqueOrThrow({ where: { personId: person.id } });
  expect(acct.status).toBe("CONNECTED");

  // The same link again: friendly "already connected"
  await page.goto(link);
  await expect(page.getByText("You're already connected")).toBeVisible();
});
