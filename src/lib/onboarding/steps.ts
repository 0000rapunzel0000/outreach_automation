// Onboarding order lives here so it can change in one place (D1: LinkedIn before approval).

export const STEP = {
  account: 0,
  terms: 1,
  details: 2,
  linkedin: 3,
  review: 4,
} as const;

export const STEP_ROUTES: Record<number, string> = {
  [STEP.account]: "/apply",
  [STEP.terms]: "/apply/terms",
  [STEP.details]: "/apply/details",
  [STEP.linkedin]: "/apply/linkedin",
  [STEP.review]: "/apply/review",
};

export const STEP_LABELS = ["Account", "Terms", "Details", "LinkedIn", "Submit"];

/**
 * Personal/payroll fields collected at the details step (D3: confirm with the business).
 * `encrypted` fields go through lib/crypto and are masked in admin views.
 */
export const DETAIL_FIELDS = {
  fullName: { label: "Full name", required: true },
  mobile: { label: "Mobile number", required: true },
  addressLine1: { label: "Address line 1", required: true },
  addressLine2: { label: "Address line 2", required: false },
  city: { label: "City", required: true },
  state: { label: "State", required: true },
  pincode: { label: "PIN code", required: true },
  pan: { label: "PAN", required: true, encrypted: true },
} as const;
