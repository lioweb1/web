import type { Bill, CaseExtraction, Encounter, ReferencedRecord } from "./schema";

export type TreatmentGap = {
  from: Encounter;
  to: Encounter;
  days: number;
  after_incident: boolean;
};

export type MissingRecord = {
  record: ReferencedRecord;
  /** Number of other mentions folded into this one. */
  mentions: number;
};

export type ProviderSummary = {
  key: string;
  provider: string;
  clinicians: string[];
  specialty: string;
  visits: number;
  first_visit: string | null;
  last_visit: string | null;
  billed: number;
  paid: number;
};

export type BillingIssue = {
  kind: "duplicate_charge" | "charge_without_record" | "visit_without_bill";
  severity: "high" | "medium" | "low";
  message: string;
  bill?: Bill;
  encounter?: Encounter;
  amount: number;
};

export type RedFlag = {
  severity: "high" | "medium" | "low";
  category: "gap" | "missing_record" | "prior_condition" | "billing" | "consistency";
  title: string;
  detail: string;
  file?: string;
  page?: number;
};

export type CaseAnalysis = {
  chronology: Encounter[];
  undated: Encounter[];
  gaps: TreatmentGap[];
  missing_records: MissingRecord[];
  providers: ProviderSummary[];
  billing_issues: BillingIssue[];
  totals: { billed: number; paid: number; duplicate_amount: number; visits: number; pages: number };
  red_flags: RedFlag[];
  case_strength: { score: number; label: string; reasons: string[] };
  hours_saved: number;
};

export type AnalyzeOptions = { gapDays?: number };

const DAY = 86_400_000;

export function parseDate(d: string | null | undefined): number | null {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

const STOP = new Set([
  "dr", "md", "do", "pa", "np", "dc", "pt", "dpt", "rn", "mr", "mrs", "ms", "the", "of", "and", "inc", "llc",
  "pc", "group", "center", "centre", "clinic", "medical", "health", "healthcare", "associates", "hospital",
  "practice", "services", "care", "department", "dept",
]);

/** Distinctive lowercase tokens of a provider or facility name. */
export function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** True when two provider/facility names plausibly refer to the same entity. */
export function sameProvider(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = new Set(nameTokens(b));
  if (ta.length === 0 || tb.size === 0) return false;
  const shared = ta.filter((t) => tb.has(t)).length;
  return shared >= Math.min(ta.length, tb.size, 2) || (shared >= 1 && Math.min(ta.length, tb.size) === 1);
}

function encounterMatchesName(e: Encounter, name: string): boolean {
  return sameProvider(e.provider_name, name) || sameProvider(e.facility, name);
}

function providerKey(e: { provider_name: string; facility: string }): string {
  const tokens = nameTokens(e.provider_name || e.facility);
  return tokens.length ? tokens.sort().join(" ") : "unknown";
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function analyzeCase(x: CaseExtraction, opts: AnalyzeOptions = {}): CaseAnalysis {
  const gapDays = opts.gapDays ?? 30;
  const incident = parseDate(x.incident_date);

  // ---- Chronology -------------------------------------------------------
  const dated = x.encounters.filter((e) => parseDate(e.date) !== null);
  const undated = x.encounters.filter((e) => parseDate(e.date) === null);
  const chronology = [...dated].sort(
    (a, b) => parseDate(a.date)! - parseDate(b.date)! || a.source.file.localeCompare(b.source.file) || a.source.page_start - b.source.page_start,
  );

  // ---- Treatment gaps (only care on/after the incident counts) ------------
  const gaps: TreatmentGap[] = [];
  const postIncident = incident === null ? chronology : chronology.filter((e) => parseDate(e.date)! >= incident);
  for (let i = 1; i < postIncident.length; i++) {
    const days = Math.round((parseDate(postIncident[i].date)! - parseDate(postIncident[i - 1].date)!) / DAY);
    if (days > gapDays) gaps.push({ from: postIncident[i - 1], to: postIncident[i], days, after_incident: incident !== null });
  }
  let delayToFirstCare: number | null = null;
  if (incident !== null && postIncident.length > 0) {
    delayToFirstCare = Math.round((parseDate(postIncident[0].date)! - incident) / DAY);
  }

  // ---- Missing records --------------------------------------------------
  const missing: MissingRecord[] = [];
  for (const ref of x.referenced_records) {
    const refDate = parseDate(ref.date);
    const candidates = x.encounters.filter((e) => encounterMatchesName(e, ref.provider_name));
    const found =
      candidates.length > 0 &&
      (refDate === null ||
        candidates.some((e) => {
          const d = parseDate(e.date);
          return d === null || Math.abs(d - refDate) <= 3 * DAY;
        }));
    if (found) continue;
    const dup = missing.find(
      (m) =>
        sameProvider(m.record.provider_name, ref.provider_name) &&
        nameTokens(m.record.record_type).some((t) => nameTokens(ref.record_type).includes(t)) &&
        (m.record.date === ref.date || !m.record.date || !ref.date),
    );
    if (dup) dup.mentions++;
    else missing.push({ record: ref, mentions: 1 });
  }

  // ---- Providers & billing ---------------------------------------------
  // Group by facility (billing usually comes from the practice, notes from the clinician).
  const providers: ProviderSummary[] = [];
  const touch = (e: { provider_name: string; facility: string }, specialty = "") => {
    const name = e.facility || e.provider_name;
    let p = providers.find((x) => sameProvider(x.provider, name) || (e.provider_name && x.clinicians.some((c) => sameProvider(c, e.provider_name))));
    if (!p) {
      p = { key: providerKey(e), provider: name || "Unknown provider", clinicians: [], specialty, visits: 0, first_visit: null, last_visit: null, billed: 0, paid: 0 };
      providers.push(p);
    }
    if (e.provider_name && e.provider_name !== p.provider && !p.clinicians.includes(e.provider_name)) p.clinicians.push(e.provider_name);
    if (!p.specialty && specialty) p.specialty = specialty;
    return p;
  };
  for (const e of chronology.concat(undated)) {
    const p = touch(e, e.specialty);
    p.visits++;
    if (e.date) {
      if (!p.first_visit || e.date < p.first_visit) p.first_visit = e.date;
      if (!p.last_visit || e.date > p.last_visit) p.last_visit = e.date;
    }
  }

  const billingIssues: BillingIssue[] = [];
  const seen = new Map<string, Bill>();
  let duplicateAmount = 0;
  for (const b of x.bills) {
    const p = touch(b);
    const sig = [providerKey(b), b.date ?? "", (b.cpt_code ?? b.description).toLowerCase().trim(), b.amount_charged.toFixed(2)].join("|");
    const prior = seen.get(sig);
    if (prior) {
      duplicateAmount += b.amount_charged;
      billingIssues.push({
        kind: "duplicate_charge",
        severity: "high",
        message: `Possible duplicate: ${b.description || b.cpt_code} on ${b.date ?? "unknown date"} for ${money(b.amount_charged)} (also on ${prior.source.file} p.${prior.source.page_start})`,
        bill: b,
        amount: b.amount_charged,
      });
      continue; // don't double count in totals
    }
    seen.set(sig, b);
    p.billed += b.amount_charged;
    p.paid += b.amount_paid ?? 0;

    const bd = parseDate(b.date);
    const supported =
      bd === null ||
      x.encounters.some((e) => {
        const ed = parseDate(e.date);
        return ed !== null && Math.abs(ed - bd) <= DAY && (encounterMatchesName(e, b.provider_name) || encounterMatchesName(e, b.facility));
      });
    if (!supported) {
      billingIssues.push({
        kind: "charge_without_record",
        severity: "medium",
        message: `${money(b.amount_charged)} billed by ${b.provider_name || b.facility} on ${b.date} has no matching treatment note — request the record or expect the charge to be challenged`,
        bill: b,
        amount: b.amount_charged,
      });
    }
  }
  if (x.bills.length > 0) {
    for (const e of chronology) {
      const ed = parseDate(e.date)!;
      const billed = x.bills.some((b) => {
        const bd = parseDate(b.date);
        return bd !== null && Math.abs(bd - ed) <= DAY && (sameProvider(b.provider_name, e.provider_name) || sameProvider(b.facility, e.facility) || sameProvider(b.provider_name, e.facility));
      });
      if (!billed && e.encounter_type !== "pharmacy") {
        billingIssues.push({
          kind: "visit_without_bill",
          severity: "low",
          message: `No bill found for ${e.encounter_type.replace(/_/g, " ")} with ${e.provider_name || e.facility} on ${e.date} — damages may be understated`,
          encounter: e,
          amount: 0,
        });
      }
    }
  }

  const providerList = [...providers].sort((a, b) => b.billed - a.billed || b.visits - a.visits);
  const billed = providerList.reduce((s, p) => s + p.billed, 0);
  const paid = providerList.reduce((s, p) => s + p.paid, 0);

  // ---- Red flags ---------------------------------------------------------
  const flags: RedFlag[] = [];
  if (delayToFirstCare !== null && delayToFirstCare > 3) {
    flags.push({
      severity: delayToFirstCare > 14 ? "high" : "medium",
      category: "gap",
      title: `${delayToFirstCare}-day delay before first treatment`,
      detail: "Defense will argue the injury was not serious or was caused by something else. Look for an explanation (no insurance, transport, symptoms developed later).",
      file: postIncident[0].source.file,
      page: postIncident[0].source.page_start,
    });
  }
  for (const g of gaps) {
    flags.push({
      severity: g.days > 90 ? "high" : "medium",
      category: "gap",
      title: `${g.days}-day gap in treatment`,
      detail: `No care between ${g.from.date} (${g.from.provider_name || g.from.facility}) and ${g.to.date} (${g.to.provider_name || g.to.facility}).`,
      file: g.to.source.file,
      page: g.to.source.page_start,
    });
  }
  for (const m of missing) {
    flags.push({
      severity: "medium",
      category: "missing_record",
      title: `Missing: ${m.record.record_type} — ${m.record.provider_name}`,
      detail: `${m.record.reason}${m.mentions > 1 ? ` (mentioned ${m.mentions}×)` : ""}`,
      file: m.record.source.file,
      page: m.record.source.page_start,
    });
  }
  for (const c of x.prior_conditions) {
    flags.push({
      severity: "high",
      category: "prior_condition",
      title: `Pre-existing: ${c.condition}`,
      detail: `“${c.evidence}” — prepare an aggravation argument and request prior records.`,
      file: c.source.file,
      page: c.source.page_start,
    });
  }
  for (const i of billingIssues.filter((b) => b.severity !== "low")) {
    flags.push({ severity: i.severity, category: "billing", title: i.kind === "duplicate_charge" ? "Duplicate charge" : "Charge without treatment note", detail: i.message, file: i.bill?.source.file, page: i.bill?.source.page_start });
  }
  // Pain-score consistency: a sharp jump back up after improvement is worth a look.
  const pain = chronology.filter((e) => e.pain_score !== null);
  for (let i = 2; i < pain.length; i++) {
    const [a, b, c] = [pain[i - 2].pain_score!, pain[i - 1].pain_score!, pain[i].pain_score!];
    if (b <= a - 3 && c >= b + 3) {
      flags.push({
        severity: "low",
        category: "consistency",
        title: "Pain score rebounded",
        detail: `Pain went ${a} → ${b} → ${c} (${pain[i].date}). Check for an intervening event the defense could blame.`,
        file: pain[i].source.file,
        page: pain[i].source.page_start,
      });
    }
  }
  const order = { high: 0, medium: 1, low: 2 } as const;
  flags.sort((a, b) => order[a.severity] - order[b.severity]);

  // ---- Case documentation strength (heuristic, explained) ---------------
  let score = 100;
  const reasons: string[] = [];
  const penalize = (n: number, why: string) => {
    score -= n;
    reasons.push(`−${n}: ${why}`);
  };
  if (delayToFirstCare !== null && delayToFirstCare > 3) penalize(Math.min(20, delayToFirstCare), `${delayToFirstCare}-day delay to first care`);
  const gapPenalty = Math.min(25, gaps.reduce((s, g) => s + (g.days > 90 ? 12 : 6), 0));
  if (gapPenalty) penalize(gapPenalty, `${gaps.length} treatment gap(s) over ${gapDays} days`);
  if (missing.length) penalize(Math.min(20, missing.length * 4), `${missing.length} referenced record(s) not in the file`);
  if (x.prior_conditions.length) penalize(Math.min(20, x.prior_conditions.length * 7), `${x.prior_conditions.length} pre-existing condition note(s)`);
  if (duplicateAmount > 0) penalize(5, `${money(duplicateAmount)} in possible duplicate charges`);
  if (chronology.some((e) => e.encounter_type === "imaging" && e.significance === "high")) {
    score += 5;
    reasons.push("+5: objective imaging findings documented");
  }
  score = Math.max(0, Math.min(100, score));
  const label = score >= 80 ? "Well documented" : score >= 60 ? "Needs attention" : "Significant documentation risk";

  const pages = x.files.reduce((s, f) => s + f.pages, 0);
  // Industry rule of thumb: a nurse reviewer covers ~40–60 pages/hour incl. summary writing.
  const hours_saved = Math.round((pages / 50) * 10) / 10;

  return {
    chronology,
    undated,
    gaps,
    missing_records: missing,
    providers: providerList,
    billing_issues: billingIssues,
    totals: { billed, paid, duplicate_amount: duplicateAmount, visits: x.encounters.length, pages },
    red_flags: flags,
    case_strength: { score, label, reasons },
    hours_saved,
  };
}
