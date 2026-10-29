import { describe, expect, it } from "vitest";
import { scoreLead, scoreCategory, type ScoreInput } from "@/lib/scoring/score";

const now = new Date("2026-10-29T12:00:00Z");
const base: ScoreInput = {
  business: { countryCode: "GB", industry: "Construction & Trades", category: null, websiteUrl: null, hasWebsite: false, registrationDate: "2026-10-10", registrationSource: "companies_house", firstDiscoveredAt: now },
  contacts: [{ type: "email", verificationStatus: "domain_valid" }, { type: "phone", verificationStatus: "unverified" }],
  analysis: null,
  signals: [],
  domain: null,
  providers: ["companies_house"],
  target: { countries: ["GB", "US"], industries: ["Construction"], technologies: ["WordPress"] },
  now,
};

describe("lead scoring", () => {
  it("is the sum of evidence-backed factors and maxes at 100", () => {
    const r = scoreLead(base);
    expect(r.factors.reduce((s, f) => s + f.max, 0)).toBe(100);
    expect(r.score).toBe(r.factors.reduce((s, f) => s + f.points, 0));
    for (const f of r.factors) if (f.points > 0) expect(f.evidence).toBeTruthy();
    expect(r.factors.find((f) => f.key === "launch")?.evidence).toMatch(/Registered 20 days ago \(UK Companies House\)/);
  });

  it("never awards points without evidence (empty business)", () => {
    const r = scoreLead({ ...base, business: { ...base.business, countryCode: null, industry: null, hasWebsite: null, registrationDate: null }, contacts: [], providers: [], target: { countries: [], industries: [], technologies: [] } });
    expect(r.score).toBe(0);
    expect(r.confidence).toBe("low");
    expect(r.missing).toEqual(expect.arrayContaining(["Country is unknown", "Industry is unknown", "No business email found"]));
  });

  it("outside target market scores 0 for market factor", () => {
    const r = scoreLead({ ...base, business: { ...base.business, countryCode: "FR" } });
    expect(r.factors.find((f) => f.key === "market")!.points).toBe(0);
  });

  it("explicit demand signal scores demand factor", () => {
    const r = scoreLead({ ...base, signals: [{ type: "website_requirement", title: "Looking for a web developer for our new shop", publishedAt: new Date("2026-10-25"), discoveredAt: now }] });
    expect(r.factors.find((f) => f.key === "demand")!.points).toBe(15);
  });

  it("categories", () => {
    expect(scoreCategory(95)).toBe("Excellent Match");
    expect(scoreCategory(75)).toBe("High Potential");
    expect(scoreCategory(50)).toBe("Moderate Potential");
    expect(scoreCategory(25)).toBe("Low Potential");
    expect(scoreCategory(24)).toBe("Weak Match");
  });
});
