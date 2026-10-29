import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import type { RuleCriteria } from "@/lib/db/schema";
import { enqueue } from "@/lib/jobs/queue";
import { getProvider } from "@/lib/providers/registry";
import { createLead } from "./leads";
import { analyzeUrl, computeScore, storeAnalysis } from "./enrich";
import { findDuplicate, upsertBusiness } from "@/lib/discovery/pipeline";
import { normalizeName, normalizeUrl, registrableDomain } from "@/lib/discovery/normalize";

/** Queue a manual (rule-less) discovery run. */
export async function startManualDiscovery(workspaceId: string, userId: string, providerId: string, criteria: RuleCriteria) {
  const p = getProvider(providerId);
  if (!p?.discover || p.unavailableReason) throw new Error("That source does not support discovery");
  if (providerId === "osm" && (criteria.countries?.length !== 1 || !criteria.cities?.length)) throw new Error("OpenStreetMap needs exactly one country and at least one city.");
  if (providerId === "crtsh" && (criteria.keyword?.trim().length ?? 0) < 4) throw new Error("Certificate Transparency search needs a keyword of at least 4 letters.");
  const job = await enqueue({ type: "discovery_run", workspaceId, payload: { providerId, criteria, requestedBy: userId, manual: true }, maxAttempts: 2 });
  if (!job) throw new Error("Could not queue the discovery run");
  return job;
}

/** Save discovered businesses as leads, score them and queue enrichment. */
export async function saveBusinessesAsLeads(workspaceId: string, userId: string, businessIds: string[], providerId: string | null) {
  const created: string[] = [];
  let existing = 0;
  for (const businessId of businessIds) {
    const res = await withTenant(workspaceId, async (tx) => {
      const { lead, created } = await createLead(tx, workspaceId, businessId, { actorId: userId, providerId, summary: `Saved from ${providerId ? (getProvider(providerId)?.name ?? providerId) : "discovery"}` });
      if (created) {
        const s = await computeScore(tx, workspaceId, businessId);
        await tx
          .update(schema.leads)
          .set({ score: s.score, scoreFactors: s.factors, scoreConfidence: s.confidence, scoreMissing: s.missing, scoreNextStep: s.nextStep, scoredAt: new Date() })
          .where(eq(schema.leads.id, lead.id));
      }
      return { lead, created };
    });
    if (res.created) {
      created.push(res.lead.id);
      await enqueue({ type: "enrich_lead", workspaceId, payload: { leadId: res.lead.id }, idempotencyKey: `enrich:${res.lead.id}:initial` });
    } else existing++;
  }
  return { created, existing };
}

/** Turn an unattributed signal into a private business + lead. */
export async function createLeadFromSignal(workspaceId: string, userId: string, signalId: string, input: { name: string; website?: string | null; countryCode?: string | null }) {
  const leadId = await withTenant(workspaceId, async (tx) => {
    const [sig] = await tx.select().from(schema.businessSignals).where(and(eq(schema.businessSignals.id, signalId), eq(schema.businessSignals.workspaceId, workspaceId)));
    if (!sig) throw new Error("Signal not found");
    const website = normalizeUrl(input.website ?? null);
    const { business } = await upsertBusiness(
      tx,
      {
        externalKey: website ? `domain:${registrableDomain(website)}` : `manual:${workspaceId}:${normalizeName(input.name)}`,
        name: input.name,
        websiteUrl: website,
        countryCode: input.countryCode ?? null,
        countryEvidence: input.countryCode ? "entered manually" : null,
        sourceUrl: sig.url ?? "",
        sourcePublishedAt: sig.publishedAt,
      },
      "manual",
      { ownerWorkspaceId: website ? null : workspaceId },
    );
    await tx.update(schema.businessSignals).set({ businessId: business.id }).where(eq(schema.businessSignals.id, signalId));
    const { lead, created } = await createLead(tx, workspaceId, business.id, { actorId: userId, providerId: sig.providerId, summary: `Created from signal: ${sig.title.slice(0, 100)}` });
    const s = await computeScore(tx, workspaceId, business.id);
    await tx.update(schema.leads).set({ score: s.score, scoreFactors: s.factors, scoreConfidence: s.confidence, scoreMissing: s.missing, scoreNextStep: s.nextStep, scoredAt: new Date() }).where(eq(schema.leads.id, lead.id));
    return { id: lead.id, created };
  });
  if (leadId.created) await enqueue({ type: "enrich_lead", workspaceId, payload: { leadId: leadId.id }, idempotencyKey: `enrich:${leadId.id}:initial` });
  return leadId.id;
}

/**
 * Analyze a URL on demand. Attaches to an existing visible business for the same domain,
 * otherwise creates a business private to this workspace so the analysis stays private.
 */
export async function analyzeAdHoc(workspaceId: string, rawUrl: string) {
  const url = normalizeUrl(rawUrl);
  const domain = registrableDomain(url);
  if (!url || !domain) throw new Error("Enter a valid public website address, e.g. example.com");
  const businessId = await withTenant(workspaceId, async (tx) => {
    const dup = await findDuplicate(tx, { domain, normalizedName: normalizeName(domain) });
    if (dup) return dup.id;
    const [b] = await tx
      .insert(schema.businesses)
      .values({ ownerWorkspaceId: workspaceId, name: domain, normalizedName: normalizeName(domain), websiteUrl: url, domain, hasWebsite: true, externalKeys: [`manual:${workspaceId}:${domain}`], lastVerifiedAt: new Date() })
      .returning();
    await tx.insert(schema.sourceObservations).values({ businessId: b.id, providerId: "manual", field: "websiteUrl", value: url, sourceRef: "website analysis" });
    return b.id;
  });
  const result = await analyzeUrl(workspaceId, url);
  const row = await withTenant(workspaceId, (tx) => storeAnalysis(tx, businessId, result));
  return { analysisId: row.id, businessId };
}
