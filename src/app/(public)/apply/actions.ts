"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { now } from "@/lib/clock";
import { audit } from "@/lib/audit";
import { clientIp, createSession, currentUser, hashPassword, userAgent } from "@/lib/auth";
import { encryptField } from "@/lib/crypto";
import { errMsg, fail } from "@/lib/flash";
import { toE164 } from "@/lib/phone";
import { rateLimit } from "@/lib/ratelimit";
import { STEP, STEP_ROUTES } from "@/lib/onboarding/steps";
import { acceptTos, currentTos } from "@/lib/tos";
import { sendWhatsAppOtp, verifyWhatsAppOtp } from "@/lib/otp";
import { notifyAdmins } from "@/lib/notify";
import { unipile } from "@/lib/unipile";
import { startReconnect } from "@/lib/monitoring/reconnect";
import { requireApplicantStep } from "./guard";

// ---- Step 0: account ----

export async function signup(form: FormData) {
  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().email("Enter a valid email."),
      password: z.string().min(10, "Password must be at least 10 characters."),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { message: "Passwords don't match.", path: ["confirm"] })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) fail("/apply", parsed.error.issues[0].message);

  const ip = await clientIp();
  if (!(await rateLimit(`signup:ip:${ip}`, 5, 3600))) fail("/apply", "Too many sign-ups from this network. Try again later.");

  const { email, password } = parsed.data;
  if (await db.user.findUnique({ where: { email } })) fail("/apply", "An account with this email already exists. Log in instead.");

  const user = await db.user.create({
    data: { email, passwordHash: await hashPassword(password), role: "APPLICANT", person: { create: { onboardingStep: STEP.terms } } },
  });
  await createSession(user.id);
  redirect(STEP_ROUTES[STEP.terms]);
}

// ---- Step 1: terms ----

export async function acceptTerms(form: FormData) {
  const { person } = await requireApplicantStep(STEP.terms);
  const tos = await currentTos();
  if (!tos || form.get("tosVersionId") !== tos.id) fail("/apply/terms", "The Terms changed while you were reading. Please review them again.");
  if (form.get("agree") !== "on") fail("/apply/terms", "Tick the box to agree to the Terms of Service.");
  await acceptTos(person.id, tos.id, await clientIp(), await userAgent());
  await db.person.update({ where: { id: person.id }, data: { onboardingStep: Math.max(person.onboardingStep, STEP.details) } });
  redirect(STEP_ROUTES[STEP.details]);
}

// ---- Step 2: details + WhatsApp OTP ----

export async function sendOtp(form: FormData) {
  const { person } = await requireApplicantStep(STEP.details);
  const phone = toE164(String(form.get("whatsapp") ?? ""));
  if (!phone) fail("/apply/details", "Enter a valid WhatsApp number.");
  if (!(await rateLimit(`otp-send:${person.id}`, 6, 3600))) fail("/apply/details", "Too many codes requested. Try again later.");
  let devCode: string | undefined;
  try {
    ({ devCode } = await sendWhatsAppOtp(person.id, phone));
  } catch (e) {
    fail("/apply/details", errMsg(e));
  }
  // Dev only (WA_DISABLED): hand the code to the page in a short-lived cookie, never in the URL.
  if (devCode) (await cookies()).set("dev_otp", devCode, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/apply/details" });
  redirect(`/apply/details?${new URLSearchParams({ otpTo: phone, ok: "Code sent on WhatsApp." })}`);
}

export async function verifyOtp(form: FormData) {
  const { person } = await requireApplicantStep(STEP.details);
  const phone = toE164(String(form.get("whatsapp") ?? ""));
  const code = String(form.get("code") ?? "");
  if (!phone || !/^\d{6}$/.test(code)) fail("/apply/details", "Enter the 6-digit code.");
  if (!(await rateLimit(`otp-verify:${person.id}`, 15, 3600))) fail("/apply/details", "Too many attempts. Try again later.");
  try {
    await verifyWhatsAppOtp(person.id, phone, code);
  } catch (e) {
    fail(`/apply/details?otpTo=${encodeURIComponent(phone)}`, errMsg(e));
  }
  redirect("/apply/details?ok=" + encodeURIComponent("WhatsApp number verified."));
}

const detailsSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name.").max(120),
    sameAsWhatsapp: z.string().optional(),
    mobile: z.string().optional(),
    addressLine1: z.string().trim().min(3, "Enter your address.").max(200),
    addressLine2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(2, "Enter your city.").max(80),
    state: z.string().trim().min(2, "Enter your state.").max(80),
    pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "PIN code must be 6 digits."),
    pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN looks wrong (e.g. ABCDE1234F)."),
    paymentMethod: z.enum(["bank", "upi"], { message: "Choose how you'd like to be paid." }),
    bankAccount: z.string().trim().optional(),
    ifsc: z.string().trim().toUpperCase().optional(),
    upiId: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.paymentMethod === "bank") {
      if (!/^\d{9,18}$/.test(v.bankAccount ?? "")) ctx.addIssue({ code: "custom", message: "Bank account number must be 9–18 digits.", path: ["bankAccount"] });
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.ifsc ?? "")) ctx.addIssue({ code: "custom", message: "IFSC looks wrong (e.g. HDFC0001234).", path: ["ifsc"] });
    } else if (!/^[\w.-]{2,256}@[a-zA-Z]{2,64}$/.test(v.upiId ?? "")) {
      ctx.addIssue({ code: "custom", message: "UPI ID looks wrong (e.g. name@okbank).", path: ["upiId"] });
    }
  });

export async function saveDetails(form: FormData) {
  const { person } = await requireApplicantStep(STEP.details);
  if (!person.whatsappVerifiedAt || !person.whatsappE164) fail("/apply/details", "Verify your WhatsApp number first.");
  const parsed = detailsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) fail("/apply/details", parsed.error.issues[0].message);
  const d = parsed.data;
  const mobile = d.sameAsWhatsapp === "on" ? person.whatsappE164 : toE164(d.mobile ?? "");
  if (!mobile) fail("/apply/details", "Enter a valid mobile number.");

  await db.person.update({
    where: { id: person.id },
    data: {
      fullName: d.fullName,
      mobileE164: mobile,
      addressLine1: d.addressLine1,
      addressLine2: d.addressLine2 || null,
      city: d.city,
      state: d.state,
      pincode: d.pincode,
      panEnc: encryptField(d.pan),
      paymentMethod: d.paymentMethod,
      bankAccountEnc: d.paymentMethod === "bank" ? encryptField(d.bankAccount!) : null,
      ifscEnc: d.paymentMethod === "bank" ? encryptField(d.ifsc!) : null,
      upiIdEnc: d.paymentMethod === "upi" ? encryptField(d.upiId!) : null,
      onboardingStep: Math.max(person.onboardingStep, STEP.linkedin),
    },
  });
  redirect(STEP_ROUTES[STEP.linkedin]);
}

// ---- Step 3: LinkedIn ----

export async function connectLinkedIn() {
  const { person } = await requireApplicantStep(STEP.linkedin);
  if (!(await rateLimit(`hosted-auth:${person.id}`, 10, 3600))) fail("/apply/linkedin", "Too many attempts. Try again later.");
  await db.person.update({ where: { id: person.id }, data: { linkedinError: null } });
  let url: string;
  try {
    ({ url } = await unipile().createHostedAuthLink({ type: "create", personId: person.id }));
  } catch (e) {
    fail("/apply/linkedin", `Couldn't start the LinkedIn connection: ${errMsg(e)}`);
  }
  redirect(url);
}

// ---- Step 4: submit ----

export async function submitApplication() {
  const { person } = await requireApplicantStep(STEP.review);
  const fresh = await db.person.findUniqueOrThrow({ where: { id: person.id }, include: { linkedin: true } });
  if (!fresh.linkedin) fail("/apply/linkedin", "Connect your LinkedIn first.");
  await db.person.update({ where: { id: person.id }, data: { status: "PENDING_REVIEW", submittedAt: now() } });
  await audit({ actorId: fresh.userId, action: "person.submit", targetType: "person", targetId: person.id });
  await notifyAdmins(
    "admin_new_application",
    { fullName: fresh.fullName ?? "An applicant", adminLink: `${env().APP_BASE_URL}/admin/applications/${person.id}` },
    { channels: ["email"] },
  );
  redirect("/apply/status");
}

// ---- Pending applicant whose LinkedIn dropped ----

export async function reconnectPending() {
  const user = await currentUser();
  if (!user?.person) redirect("/login");
  const r = await startReconnect(user.person.id);
  if (r.kind === "redirect") redirect(r.url);
  redirect("/apply/status");
}
