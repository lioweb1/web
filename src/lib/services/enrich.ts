import { and, desc, eq } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/lib/db";
import { analyzeWebsite, type AnalysisResult } from "@/lib/analysis/analyzer";
import { defaultResolver, defaultTlsChecker, type Resolver, type TlsChecker } from "@/lib/analysis/net";
import { checkEmail, defaultDns, type DnsDeps } from "@/lib/analysis/email";
import { rdapLookup } from "@/lib/providers/rdap";
import { scoreLead, type ScoreResult } from "@/lib/scoring/score";
import { providerContext, recordProviderResult, httpClient } from "./integrations";
import { consumeUsage } from "@/lib/plans";
import { registrableDomain, normalizeEmail, normalizePhone } from "@/lib/discovery/normalize";
import { upsertDomain } from "@/lib/discovery/pipeline";
import { PREMIUM_MARKETS } from "@/lib/countries";

/** Network primitives, replaceable in tests. */
export const netDeps: { resolve: Resolver; tls: TlsChecker; dns: DnsDeps } = { resolve: defaultResolver, tls: defaultTlsChecker, dns: defaultDns };

export async function analyzeUrl(workspaceId: string, url: string): Promise<AnalysisResult> {
  const analyzerCtx = await providerContext(workspaceId, "website_analyzer");
  if (!analyzerCtx.enabled) throw new Error("The website analyzer is disabled on the Integrations page.");
  const ps = await providerContext(workspaceId, "pagespeed");
  await consumeUsage(workspaceId, "websiteAnalysesPerMonth");
  const http = httpClient();
  try {
    const r = await analyzeWebsite(url, { http, resolve: netDeps.resolve, tls: netDeps.tls, pagespeed: { enabled: ps.enabled, apiKey: ps.secrets.apiKey } });
    await recordProviderResult(workspaceId, "website_analyzer", { ok: true });
    return r;
  } catch (e) {
    await recordProviderResult(workspaceId, "website_analyzer", { ok: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Persist an analysis for a business: analysis row, contacts found on the site, domain status. */
export async function storeAnalysis(tx: Tx, businessId: string | null, r: AnalysisResult) {
  const [row] = await tx
    .insert(schema.websiteAnalyses)
    .values({
      businessId,
      url: r.url,
      finalUrl: r.finalUrl,
      httpStatus: r.httpStatus,
      reachable: r.reachable,
      https: r.https,
      responseMs: r.responseMs,
      pageBytes: r.pageBytes,
      title: r.title,
      technologies: r.technologies,
      issues: r.issues,
      opportunities: r.opportunities,
      metrics: r.metrics,
      error: r.error,
    })
    .returning();
  const [owner] = businessId ? await tx.select({ keys: schema.businesses.externalKeys }).from(schema.businesses).where(eq(schema.businesses.id, businessId)) : [];
  if (businessId && !owner?.keys.includes("suppressed")) {
    for (const c of r.contacts) {
      const normalized = c.type === "email" ? normalizeEmail(c.value) : c.type === "phone" ? normalizePhone(c.value) : c.value.toLowerCase().replace(/\/$/, "");
      if (!normalized) continue;
      await tx
        .insert(schema.contacts)
        .values({ businessId, type: c.type, value: c.value, normalizedValue: normalized, providerId: "website_analyzer", sourceUrl: c.sourceUrl })
        .onConflictDoNothing();
    }
    await tx.update(schema.businesses).set({ hasWebsite: true, lastVerifiedAt: new Date() }).where(eq(schema.businesses.id, businessId));
  }
  const domain = registrableDomain(r.finalUrl ?? r.url);
  if (domain) {
    await upsertDomain(tx, domain, "website_analyzer", r.url, businessId, null);
    await tx
      .update(schema.domains)
      .set({
        websiteStatus: r.reachable ? "online" : r.httpStatus ? `http_${r.httpStatus}` : "unreachable",
        websiteHttpStatus: r.httpStatus,
        sslStatus: r.https === false ? "none" : r.tls ? (r.tls.valid ? "valid" : "invalid") : null,
        sslIssuer: r.tls?.issuer ?? null,
        sslValidTo: r.tls?.validTo ?? null,
        lastCheckedAt: new Date(),
      })
      .where(eq(schema.domains.domain, domain));
  }
  return row;
}

export async function analyzeBusiness(workspaceId: string, businessId: string) {
  const biz = await withTenant(workspaceId, async (tx) => (await tx.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)))[0]);
  if (!biz) throw new Error("Business not found");
  if (!biz.websiteUrl) return null;
  const r = await analyzeUrl(workspaceId, biz.websiteUrl);
  return withTenant(workspaceId, (tx) => storeAnalysis(tx, businessId, r));
}

/** RDAP registration data + DNS records for a domain. */
export async function enrichDomain(workspaceId: string, domain: string) {
  const ctx = await providerContext(workspaceId, "rdap");
  let rdap = null;
  if (ctx.enabled) {
    try {
      rdap = await rdapLookup(ctx.http, domain);
      await recordProviderResult(workspaceId, "rdap", { ok: true });
    } catch (e) {
      await recordProviderResult(workspaceId, "rdap", { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const [a, mx] = await Promise.all([netDeps.dns.resolveA(domain).catch(() => []), netDeps.dns.resolveMx(domain).catch(() => [])]);
  return withTenant(workspaceId, async (tx) => {
    await upsertDomain(tx, domain, "rdap", null, null, null);
    const [row] = await tx
      .update(schema.domains)
      .set({
        ...(rdap?.found ? { registeredAt: rdap.registeredAt, registrar: rdap.registrar, rdapStatus: rdap.status } : {}),
        lastRdapAt: rdap ? new Date() : undefined,
        dnsA: a,
        dnsMx: mx.map((m) => m.exchange),
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.domains.domain, domain))
      .returning();
    return { domain: row, rdapFound: rdap?.found ?? null };
  });
}

/** Syntax + MX checks for a business's emails. Never upgrades to "verified_by_provider". */
export async function verifyBusinessEmails(workspaceId: string, businessId: string) {
  const ctx = await providerContext(workspaceId, "dns_email");
  if (!ctx.enabled) return 0;
  const emails = await withTenant(workspaceId, (tx) =>
    tx.select().from(schema.contacts).where(and(eq(schema.contacts.businessId, businessId), eq(schema.contacts.type, "email"))),
  );
  for (const e of emails) {
    if (e.verificationStatus === "verified_by_provider") continue;
    const res = await checkEmail(e.normalizedValue, netDeps.dns);
    await withTenant(workspaceId, (tx) =>
      tx.update(schema.contacts).set({ verificationStatus: res.status, verificationDetail: res.detail, verifiedAt: new Date(), updatedAt: new Date() }).where(eq(schema.contacts.id, e.id)),
    );
  }
  return emails.length;
}

export async function workspaceTarget(tx: Tx, workspaceId: string, override?: { countries?: string[]; industries?: string[] }) {
  const [ws] = await tx.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  let countries: string[] = [...PREMIUM_MARKETS];
  if (ws?.defaultTargetMarketId) {
    const [m] = await tx.select().from(schema.targetMarkets).where(eq(schema.targetMarkets.id, ws.defaultTargetMarketId));
    if (m) countries = m.mode === "all" ? [] : m.countries;
  }
  return {
    countries: override?.countries?.length ? override.countries : countries,
    industries: override?.industries?.length ? override.industries : (ws?.settings.targetIndustries ?? []),
    technologies: ws?.settings.preferredTechnologies ?? ["WordPress", "Webflow"],
  };
}

export async function computeScore(tx: Tx, workspaceId: string, businessId: string, override?: { countries?: string[]; industries?: string[] }): Promise<ScoreResult> {
  const [biz] = await tx.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) throw new Error("Business not found");
  const [contacts, analyses, signals, domainRows, obs, target] = await Promise.all([
    tx.select().from(schema.contacts).where(eq(schema.contacts.businessId, businessId)),
    tx.select().from(schema.websiteAnalyses).where(eq(schema.websiteAnalyses.businessId, businessId)).orderBy(desc(schema.websiteAnalyses.analyzedAt)).limit(1),
    tx.select().from(schema.businessSignals).where(and(eq(schema.businessSignals.businessId, businessId), eq(schema.businessSignals.workspaceId, workspaceId))),
    biz.domain ? tx.select().from(schema.domains).where(eq(schema.domains.domain, biz.domain)) : Promise.resolve([]),
    tx.selectDistinct({ providerId: schema.sourceObservations.providerId }).from(schema.sourceObservations).where(eq(schema.sourceObservations.businessId, businessId)),
    workspaceTarget(tx, workspaceId, override),
  ]);
  const a = analyses[0];
  return scoreLead({
    business: biz,
    contacts,
    analysis: a ? { reachable: a.reachable, issues: a.issues, technologies: a.technologies, analyzedAt: a.analyzedAt } : null,
    signals: signals.map((s) => ({ type: s.type, title: s.title, publishedAt: s.publishedAt, discoveredAt: s.discoveredAt })),
    domain: domainRows[0] ?? null,
    providers: obs.map((o) => o.providerId),
    target,
  });
}

export async function rescoreLead(workspaceId: string, leadId: string) {
  return withTenant(workspaceId, async (tx) => {
    const [lead] = await tx.select().from(schema.leads).where(eq(schema.leads.id, leadId));
    if (!lead) throw new Error("Lead not found");
    const s = await computeScore(tx, workspaceId, lead.businessId);
    await tx
      .update(schema.leads)
      .set({ score: s.score, scoreFactors: s.factors, scoreConfidence: s.confidence, scoreMissing: s.missing, scoreNextStep: s.nextStep, scoredAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.leads.id, leadId));
    if (lead.score !== s.score) {
      await tx.insert(schema.activities).values({ workspaceId, leadId, kind: "score", summary: `Score ${lead.scoredAt ? `changed ${lead.score} → ${s.score}` : `calculated: ${s.score}`}`, metadata: { score: s.score } });
    }
    return s;
  });
}

/** Full enrichment for one business: website analysis, domain RDAP/DNS, email checks. Failures of one step don't block others. */
export async function enrichBusiness(workspaceId: string, businessId: string, opts: { analyze: boolean }) {
  const errors: string[] = [];
  const biz = await withTenant(workspaceId, async (tx) => (await tx.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)))[0]);
  if (!biz) throw new Error("Business not found");
  if (opts.analyze && biz.websiteUrl) {
    const recent = await withTenant(workspaceId, (tx) =>
      tx.select({ at: schema.websiteAnalyses.analyzedAt }).from(schema.websiteAnalyses).where(eq(schema.websiteAnalyses.businessId, businessId)).orderBy(desc(schema.websiteAnalyses.analyzedAt)).limit(1),
    );
    if (!recent[0] || Date.now() - recent[0].at.getTime() > 7 * 86400_000) {
      await analyzeBusiness(workspaceId, businessId).catch((e) => errors.push(`Website analysis: ${e instanceof Error ? e.message : e}`));
    }
  }
  if (biz.domain) await enrichDomain(workspaceId, biz.domain).catch((e) => errors.push(`Domain: ${e instanceof Error ? e.message : e}`));
  await verifyBusinessEmails(workspaceId, businessId).catch((e) => errors.push(`Email checks: ${e instanceof Error ? e.message : e}`));
  return { errors };
}
