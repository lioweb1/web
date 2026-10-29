import type { ScoreFactor } from "@/lib/db/schema";
import { isDemandSignal } from "@/lib/discovery/classify";
import { primaryPlatform } from "@/lib/analysis/detect";
import { sourceReliability, sourceName } from "@/lib/providers/registry";
import type { SignalKind } from "@/lib/providers/types";

export type ScoreInput = {
  business: {
    countryCode: string | null;
    industry: string | null;
    category: string | null;
    websiteUrl: string | null;
    hasWebsite: boolean | null;
    registrationDate: string | null;
    registrationSource: string | null;
    firstDiscoveredAt: Date;
  };
  contacts: { type: string; verificationStatus: string }[];
  analysis: { reachable: boolean; issues: { code: string; severity: string; kind: string; label: string }[]; technologies: { name: string; category: string }[]; analyzedAt: Date } | null;
  signals: { type: SignalKind; title: string; publishedAt: Date | null; discoveredAt: Date }[];
  domain: { registeredAt: Date | null } | null;
  providers: string[];
  target: { countries: string[]; industries: string[]; technologies: string[] };
  now?: Date;
};

export type ScoreResult = {
  score: number;
  category: ScoreCategory;
  factors: ScoreFactor[];
  confidence: "low" | "medium" | "high";
  missing: string[];
  nextStep: string;
};

export type ScoreCategory = "Excellent Match" | "High Potential" | "Moderate Potential" | "Low Potential" | "Weak Match";

export function scoreCategory(score: number): ScoreCategory {
  if (score >= 90) return "Excellent Match";
  if (score >= 75) return "High Potential";
  if (score >= 50) return "Moderate Potential";
  if (score >= 25) return "Low Potential";
  return "Weak Match";
}

const days = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 86400_000;

/**
 * Explainable 0–100 qualification score. Every point awarded carries the evidence that
 * produced it; factors without evidence score 0 and are listed as missing information.
 * Scores are qualification categories, not purchase probabilities.
 */
export function scoreLead(input: ScoreInput): ScoreResult {
  const now = input.now ?? new Date();
  const factors: ScoreFactor[] = [];
  const missing: string[] = [];
  const f = (key: string, label: string, max: number, points: number, evidence: string | null) => factors.push({ key, label, max, points: Math.max(0, Math.min(max, Math.round(points))), evidence });
  const b = input.business;

  // 1. Target market (10)
  if (!b.countryCode) {
    f("market", "Target country match", 10, 0, null);
    missing.push("Country is unknown");
  } else if (input.target.countries.length === 0 || input.target.countries.includes(b.countryCode)) {
    f("market", "Target country match", 10, 10, input.target.countries.length ? `${b.countryCode} is in your target markets` : "All countries targeted");
  } else f("market", "Target country match", 10, 0, `${b.countryCode} is outside your target markets`);

  // 2. Industry relevance (10)
  const ind = b.industry ?? b.category;
  if (!ind) {
    f("industry", "Industry relevance", 10, 0, null);
    missing.push("Industry is unknown");
  } else if (input.target.industries.length === 0) {
    f("industry", "Industry relevance", 10, 5, `Industry "${ind}" (no target industries set — neutral)`);
  } else if (input.target.industries.some((t) => ind.toLowerCase().includes(t.toLowerCase()))) {
    f("industry", "Industry relevance", 10, 10, `"${ind}" matches your target industries`);
  } else f("industry", "Industry relevance", 10, 0, `"${ind}" is not in your target industries`);

  // 3. Business launch signals (15) — strongest verified evidence wins
  const launchCandidates: [number, string][] = [];
  if (b.registrationDate) {
    const age = days(now, new Date(b.registrationDate));
    const src = b.registrationSource ? ` (${sourceName(b.registrationSource)})` : "";
    if (age <= 90) launchCandidates.push([15, `Registered ${Math.max(0, Math.round(age))} days ago${src}`]);
    else if (age <= 365) launchCandidates.push([8, `Registered ${Math.round(age / 30)} months ago${src}`]);
  }
  if (input.domain?.registeredAt) {
    const age = days(now, input.domain.registeredAt);
    if (age <= 90) launchCandidates.push([10, `Domain registered ${Math.max(0, Math.round(age))} days ago (RDAP)`]);
    else if (age <= 365) launchCandidates.push([5, `Domain registered ${Math.round(age / 30)} months ago (RDAP)`]);
  }
  for (const s of input.signals) {
    const when = s.publishedAt ?? s.discoveredAt;
    if (s.type === "business_launch" && days(now, when) <= 180) launchCandidates.push([12, `Launch signal: "${s.title.slice(0, 80)}"`]);
    if (s.type === "new_domain" && days(now, when) <= 60) launchCandidates.push([6, `New TLS certificate observed ${when.toISOString().slice(0, 10)} (setup signal, not a registration date)`]);
  }
  const bestLaunch = launchCandidates.sort((a, c) => c[0] - a[0])[0];
  f("launch", "Business launch signals", 15, bestLaunch?.[0] ?? 0, bestLaunch?.[1] ?? null);
  if (!bestLaunch) missing.push("No dated launch or registration evidence");

  // 4. Website availability (10)
  const a = input.analysis;
  if (b.hasWebsite === false || (!b.websiteUrl && b.hasWebsite !== true)) {
    if (b.hasWebsite === false) f("availability", "Website availability", 10, 10, "No website listed by the source");
    else {
      f("availability", "Website availability", 10, 0, null);
      missing.push("Website status unknown");
    }
  } else if (a && !a.reachable) f("availability", "Website availability", 10, 10, "Website is unreachable or returns an error");
  else if (a) f("availability", "Website availability", 10, 2, "Website is online");
  else {
    f("availability", "Website availability", 10, 0, null);
    missing.push("Website not analyzed yet");
  }

  // 5. Technical condition (15) — measured issues weigh more than heuristics
  if (a && a.reachable) {
    let pts = 0;
    const counted: string[] = [];
    for (const i of a.issues) {
      const w = (i.severity === "high" ? 5 : i.severity === "medium" ? 3 : 1) * (i.kind === "heuristic" ? 0.5 : 1);
      pts += w;
      if (w >= 3) counted.push(i.label);
    }
    f("technical", "Website technical condition", 15, pts, a.issues.length ? `${a.issues.length} issues found${counted.length ? `: ${counted.slice(0, 3).join(", ")}` : ""}` : "No technical issues detected");
  } else if (a && !a.reachable) f("technical", "Website technical condition", 15, 12, "Site not working");
  else f("technical", "Website technical condition", 15, 0, b.hasWebsite === false ? "Not applicable (no website)" : null);

  // 6. Public evidence of demand (15)
  const demand = input.signals.filter((s) => isDemandSignal(s.type));
  if (demand.length) {
    const recent = [...demand].sort((x, y) => (y.publishedAt ?? y.discoveredAt).getTime() - (x.publishedAt ?? x.discoveredAt).getTime())[0];
    f("demand", "Public evidence of development demand", 15, days(now, recent.publishedAt ?? recent.discoveredAt) <= 60 ? 15 : 8, `"${recent.title.slice(0, 90)}"`);
  } else f("demand", "Public evidence of development demand", 15, 0, null);

  // 7. Technology compatibility (5)
  const platform = a ? primaryPlatform(a.technologies) : null;
  if (b.hasWebsite === false) f("tech", "Technology compatibility", 5, 3, "Greenfield build — any stack");
  else if (platform && input.target.technologies.some((t) => platform.toLowerCase().includes(t.toLowerCase()))) f("tech", "Technology compatibility", 5, 5, `Built on ${platform}, which you work with`);
  else if (platform) f("tech", "Technology compatibility", 5, 2, `Built on ${platform} (migration opportunity)`);
  else f("tech", "Technology compatibility", 5, 0, a ? "Platform not identified" : null);

  // 8. Contact availability (10)
  let cpts = 0;
  const cev: string[] = [];
  const emails = input.contacts.filter((c) => c.type === "email");
  if (emails.some((e) => e.verificationStatus === "verified_by_provider")) (cpts += 6), cev.push("provider-verified email");
  else if (emails.some((e) => e.verificationStatus === "domain_valid")) (cpts += 4), cev.push("email on a domain that accepts mail");
  else if (emails.some((e) => e.verificationStatus !== "invalid")) (cpts += 2), cev.push("unverified email");
  if (input.contacts.some((c) => c.type === "phone")) (cpts += 3), cev.push("phone");
  if (input.contacts.some((c) => ["contact_page", "linkedin", "facebook"].includes(c.type))) (cpts += 1), cev.push("contact page/social");
  f("contact", "Business contact availability", 10, cpts, cev.length ? cev.join(", ") : null);
  if (!emails.length) missing.push("No business email found");

  // 9. Recency of evidence (5)
  const dates = [...input.signals.map((s) => s.publishedAt ?? s.discoveredAt), a?.analyzedAt, b.registrationDate ? new Date(b.registrationDate) : null].filter((d): d is Date => !!d);
  const newest = dates.sort((x, y) => y.getTime() - x.getTime())[0];
  if (newest) {
    const age = days(now, newest);
    f("recency", "Recency of evidence", 5, age <= 30 ? 5 : age <= 90 ? 3 : age <= 365 ? 1 : 0, `Most recent evidence: ${newest.toISOString().slice(0, 10)}`);
  } else f("recency", "Recency of evidence", 5, 0, null);

  // 10. Source reliability (5)
  const rel = Math.max(0, ...input.providers.map(sourceReliability));
  const relSrc = [...input.providers].sort((x, y) => sourceReliability(y) - sourceReliability(x))[0];
  f("reliability", "Data source reliability", 5, rel * 5, relSrc ? `${sourceName(relSrc)}${input.providers.length > 1 ? ` + ${input.providers.length - 1} more source(s)` : ""}` : null);

  const score = factors.reduce((s, x) => s + x.points, 0);
  const withEvidence = factors.filter((x) => x.evidence).length;
  const confidence = withEvidence >= 8 ? "high" : withEvidence >= 5 ? "medium" : "low";
  return { score, category: scoreCategory(score), factors, confidence, missing, nextStep: nextStep(input, score) };
}

function nextStep(input: ScoreInput, score: number): string {
  const hasEmail = input.contacts.some((c) => c.type === "email" && c.verificationStatus !== "invalid");
  const hasPhone = input.contacts.some((c) => c.type === "phone");
  if (input.business.websiteUrl && !input.analysis) return "Run a website analysis to measure technical issues.";
  if (!hasEmail && !hasPhone) return input.business.websiteUrl ? "Find a contact: check the website's contact page manually." : "Find a contact via the source listing before reaching out.";
  if (score >= 75) return hasEmail ? "Review the evidence and send a personalised, relevant introduction." : "Call during business hours with a specific observation.";
  if (score >= 50) return "Review the evidence; qualify manually before contacting.";
  return "Low priority — keep for monitoring; re-check when new signals appear.";
}
