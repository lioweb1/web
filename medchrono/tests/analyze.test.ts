import { describe, expect, it } from "vitest";
import { analyzeCase, sameProvider } from "@/lib/analyze";
import { DEMO_CASE } from "@/lib/demo";
import { mergeChunks } from "@/lib/merge";
import { recordsRequestLetter } from "@/lib/letters";

describe("sameProvider", () => {
  it("matches name variants and rejects different people", () => {
    expect(sameProvider("Dr. Ravi Patel, MD", "Ravi Patel")).toBe(true);
    expect(sameProvider("Summit Orthopedic Specialists", "Summit Orthopedics Specialists LLC")).toBe(true);
    expect(sameProvider("Dr. Ravi Patel", "Dr. Jenna Lee")).toBe(false);
    expect(sameProvider("", "Dr. Lee")).toBe(false);
  });
});

describe("analyzeCase on the demo case", () => {
  const a = analyzeCase(DEMO_CASE);

  it("orders the chronology and keeps undated entries aside", () => {
    expect(a.chronology.map((e) => e.date)).toEqual([...a.chronology.map((e) => e.date)].sort());
    expect(a.undated).toHaveLength(1);
  });

  it("finds the May–August treatment gap", () => {
    expect(a.gaps).toHaveLength(1);
    expect(a.gaps[0].from.date).toBe("2026-05-15");
    expect(a.gaps[0].days).toBe(98);
  });

  it("flags only records that are not present", () => {
    const names = a.missing_records.map((m) => m.record.provider_name);
    expect(names).toContain("Valley Imaging Center");
    expect(names).toContain("Dr. Jenna Lee");
    expect(names).toContain("Harbor Chiropractic");
    expect(names).not.toContain("MoveWell Physical Therapy");
  });

  it("catches the duplicate PT charge and excludes it from totals", () => {
    const dup = a.billing_issues.filter((i) => i.kind === "duplicate_charge");
    expect(dup).toHaveLength(1);
    expect(a.totals.duplicate_amount).toBe(220);
    const all = DEMO_CASE.bills.reduce((s, b) => s + b.amount_charged, 0);
    expect(a.totals.billed).toBe(all - 220);
  });

  it("flags the MRI charge with no treatment note", () => {
    const orphan = a.billing_issues.filter((i) => i.kind === "charge_without_record");
    expect(orphan.map((i) => i.bill?.cpt_code)).toEqual(["72141"]);
  });

  it("produces an explained strength score and red flags", () => {
    expect(a.case_strength.score).toBeGreaterThan(0);
    expect(a.case_strength.score).toBeLessThan(100);
    expect(a.case_strength.reasons.length).toBeGreaterThan(0);
    expect(a.red_flags[0].severity).toBe("high");
  });
});

describe("mergeChunks", () => {
  it("converts relative pages to absolute and clamps them to the chunk", () => {
    const x = mergeChunks("t", [{ name: "a.pdf", pages: 60 }], [
      {
        file: "a.pdf", firstPage: 31, lastPage: 60,
        data: {
          patient_name: "X", patient_dob: null, incident_date: "2026-01-02", incident_description: null,
          encounters: [], prior_conditions: [], referenced_records: [],
          bills: [
            { date: "2026-01-03", provider_name: "P", facility: "", description: "d", cpt_code: null, amount_charged: 10, amount_paid: null, page: 2 },
            { date: "2026-01-03", provider_name: "P", facility: "", description: "e", cpt_code: null, amount_charged: 10, amount_paid: null, page: 99 },
          ],
        },
      },
    ]);
    expect(x.bills.map((b) => b.source.page_start)).toEqual([32, 60]);
    expect(x.incident_date).toBe("2026-01-02");
  });
});

describe("recordsRequestLetter", () => {
  it("names the patient, provider and the page that proves the record exists", () => {
    const a = analyzeCase(DEMO_CASE);
    const m = a.missing_records.find((r) => r.record.provider_name === "Valley Imaging Center")!;
    const letter = recordsRequestLetter(DEMO_CASE, m);
    expect(letter).toContain("Elena Rivera");
    expect(letter).toContain("Valley Imaging Center");
    expect(letter).toContain("page 3");
  });
});
