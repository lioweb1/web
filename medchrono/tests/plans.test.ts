import { describe, expect, it } from "vitest";
import { creditsFor, planSpend } from "@/lib/plans";

describe("creditsFor", () => {
  it("charges one credit per started 1,000 pages", () => {
    expect(creditsFor(1)).toBe(1);
    expect(creditsFor(1000)).toBe(1);
    expect(creditsFor(1001)).toBe(2);
    expect(creditsFor(4500)).toBe(5);
  });
});

describe("planSpend", () => {
  it("uses the free trial first for small cases", () => {
    expect(planSpend({ trial: 1, plan: 5, purchased: 0 }, 200)).toEqual({ ok: true, spend: { trial: 1, plan: 0, purchased: 0, credits: 1 } });
  });
  it("does not use the trial for big cases and explains why", () => {
    const r = planSpend({ trial: 1, plan: 0, purchased: 0 }, 800);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("free trial covers one case of up to 300 pages");
  });
  it("spends expiring plan credits before purchased ones", () => {
    expect(planSpend({ trial: 0, plan: 1, purchased: 5 }, 2500)).toEqual({ ok: true, spend: { trial: 0, plan: 1, purchased: 2, credits: 3 } });
  });
  it("refuses when the balance is short", () => {
    const r = planSpend({ trial: 0, plan: 0, purchased: 1 }, 1200);
    expect(r).toMatchObject({ ok: false, need: 2 });
  });
});
