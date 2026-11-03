/** Bump when the Terms or Privacy Policy change materially; stored on each user at signup. */
export const TERMS_VERSION = "2026-11-03";

/** Legal entity details shown in the Terms and Privacy Policy. Set these before launch. */
export const LEGAL = {
  company: process.env.NEXT_PUBLIC_LEGAL_COMPANY || "[Company Name, LLC]",
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS || "[Registered address]",
  state: process.env.NEXT_PUBLIC_LEGAL_STATE || "[State of governing law, e.g. Delaware]",
  email: process.env.NEXT_PUBLIC_LEGAL_EMAIL || "legal@example.com",
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL || "privacy@example.com",
  product: "MedChrono AI",
  effective: "November 3, 2026",
};
