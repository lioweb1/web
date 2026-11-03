/** Pricing and credit rules. One credit = one case of up to PAGES_PER_CREDIT pages. */

export const PAGES_PER_CREDIT = 1000;
export const TRIAL_MAX_PAGES = 300;
export const FIRM_MONTHLY_CREDITS = 25;
export const MAX_CONCURRENT_ANALYSES = 2;

export type PackId = "case_1" | "case_5" | "case_20";
export type ProductId = PackId | "firm";

export const PACKS: Record<PackId, { credits: number; amount: number; label: string }> = {
  case_1: { credits: 1, amount: 14_900, label: "1 case" },
  case_5: { credits: 5, amount: 69_500, label: "5 cases" },
  case_20: { credits: 20, amount: 249_000, label: "20 cases" },
};

export const FIRM_PLAN = { amount: 149_000, credits: FIRM_MONTHLY_CREDITS, label: "Firm plan" };

export function isProduct(x: unknown): x is ProductId {
  return x === "firm" || (typeof x === "string" && x in PACKS);
}

/** Credits a case of `pages` pages costs. */
export function creditsFor(pages: number): number {
  return Math.max(1, Math.ceil(pages / PAGES_PER_CREDIT));
}

export const usdCents = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: c % 100 ? 2 : 0 });

export type Balance = { trial: number; plan: number; purchased: number };

export type Spend = { trial: number; plan: number; purchased: number; credits: number };

export type SpendResult = { ok: true; spend: Spend } | { ok: false; reason: string; need: number };

/**
 * Decides which credits pay for a case. The free trial covers one small case and is used
 * first; then monthly plan credits (they expire) before purchased ones (they don't).
 */
export function planSpend(b: Balance, pages: number): SpendResult {
  if (b.trial > 0 && pages <= TRIAL_MAX_PAGES) return { ok: true, spend: { trial: 1, plan: 0, purchased: 0, credits: 1 } };
  const need = creditsFor(pages);
  if (b.plan + b.purchased < need) {
    const trialNote = b.trial > 0 ? ` Your free trial covers one case of up to ${TRIAL_MAX_PAGES} pages; this one has ${pages.toLocaleString()}.` : "";
    return { ok: false, need, reason: `This case has ${pages.toLocaleString()} pages and needs ${need} credit${need > 1 ? "s" : ""}; you have ${b.plan + b.purchased}.${trialNote}` };
  }
  const plan = Math.min(b.plan, need);
  return { ok: true, spend: { trial: 0, plan, purchased: need - plan, credits: need } };
}
