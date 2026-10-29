import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/lib/db";
import type { RuleCriteria } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers/registry";
import type { DiscoveredRecord, DiscoveredSignal, DiscoveredUnattributedSignal } from "@/lib/providers/types";
import { providerContext, recordProviderResult } from "@/lib/services/integrations";
import { cleanName, normalizeEmail, normalizeName, normalizePhone, normalizeUrl, registrableDomain, tldOf } from "./normalize";
import { consumeUsage } from "@/lib/plans";

type Business = typeof schema.businesses.$inferSelect;

/** Fields copied from a record onto the canonical business when the business has no value yet. */
const FILLABLE = ["category", "industry", "businessType", "countryCode", "region", "city", "address", "postcode", "lat", "lon", "websiteUrl"] as const;

/**
 * Find the canonical business a record refers to: same upstream key, then same
 * registrable domain, then same normalized name in the same country + city.
 */
export async function findDuplicate(tx: Tx, rec: { externalKey?: string; domain: string | null; normalizedName: string; countryCode?: string | null; city?: string | null }): Promise<Business | null> {
  const live = isNull(schema.businesses.mergedIntoId);
  if (rec.externalKey) {
    const [m] = await tx.select().from(schema.businesses).where(and(live, sql`${schema.businesses.externalKeys} @> array[${rec.externalKey}]::text[]`)).limit(1);
    if (m) return m;
  }
  if (rec.domain) {
    const [m] = await tx.select().from(schema.businesses).where(and(live, eq(schema.businesses.domain, rec.domain))).limit(1);
    if (m) return m;
  }
  if (rec.normalizedName.length >= 3 && rec.countryCode && rec.city) {
    const [m] = await tx
      .select()
      .from(schema.businesses)
      .where(and(live, eq(schema.businesses.normalizedName, rec.normalizedName), eq(schema.businesses.countryCode, rec.countryCode), sql`lower(${schema.businesses.city}) = lower(${rec.city})`))
      .limit(1);
    if (m) return m;
  }
  return null;
}

export type UpsertOutcome = { business: Business; created: boolean };

/** Insert or update the canonical business for a discovered record, preserving field provenance. */
export async function upsertBusiness(tx: Tx, rec: DiscoveredRecord, providerId: string, opts: { ownerWorkspaceId?: string | null } = {}): Promise<UpsertOutcome> {
  const websiteUrl = normalizeUrl(rec.websiteUrl);
  const domain = registrableDomain(websiteUrl);
  const name = cleanName(rec.name);
  const normalizedName = normalizeName(name) || name.toLowerCase();
  const now = new Date();
  const existing = await findDuplicate(tx, { externalKey: rec.externalKey, domain, normalizedName, countryCode: rec.countryCode, city: rec.city });

  const incoming: Record<string, unknown> = {
    category: rec.category ?? null, industry: rec.industry ?? null, businessType: rec.businessType ?? null,
    countryCode: rec.countryCode ?? null, region: rec.region ?? null, city: rec.city ?? null, address: rec.address ?? null,
    postcode: rec.postcode ?? null, lat: rec.lat ?? null, lon: rec.lon ?? null, websiteUrl,
  };
  let business: Business;
  let created = false;
  if (!existing) {
    [business] = await tx
      .insert(schema.businesses)
      .values({
        ownerWorkspaceId: opts.ownerWorkspaceId ?? null,
        name,
        normalizedName,
        ...(incoming as object),
        domain,
        hasWebsite: websiteUrl ? true : rec.noWebsiteListed ? false : null,
        externalKeys: [rec.externalKey],
        registrationDate: rec.registrationDate ?? null,
        registrationSource: rec.registrationDate ? providerId : null,
        sourcePublishedAt: rec.sourcePublishedAt ?? null,
        firstDiscoveredAt: now,
        lastVerifiedAt: now,
      })
      .returning();
    created = true;
  } else {
    const patch: Record<string, unknown> = { lastVerifiedAt: now, updatedAt: now };
    for (const k of FILLABLE) if (existing[k] === null && incoming[k] !== null && incoming[k] !== undefined) patch[k] = incoming[k];
    if (!existing.domain && domain) patch.domain = domain;
    if (websiteUrl) patch.hasWebsite = true;
    else if (existing.hasWebsite === null && rec.noWebsiteListed) patch.hasWebsite = false;
    if (!existing.externalKeys.includes(rec.externalKey)) patch.externalKeys = [...existing.externalKeys, rec.externalKey];
    // A registry-verified registration date replaces a weaker or missing one.
    if (rec.registrationDate && !existing.registrationDate) {
      patch.registrationDate = rec.registrationDate;
      patch.registrationSource = providerId;
    }
    if (rec.sourcePublishedAt && (!existing.sourcePublishedAt || rec.sourcePublishedAt > existing.sourcePublishedAt)) patch.sourcePublishedAt = rec.sourcePublishedAt;
    [business] = await tx.update(schema.businesses).set(patch).where(eq(schema.businesses.id, existing.id)).returning();
  }

  // Provenance: record what this source said for each field it supplied.
  const observed: [string, unknown][] = [["name", name], ...Object.entries(incoming), ["registrationDate", rec.registrationDate], ["phone", rec.phone], ["email", rec.email]];
  if (rec.countryEvidence && rec.countryCode) observed.push(["countryEvidence", rec.countryEvidence]);
  const rows = observed
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([field, value]) => ({
      businessId: business.id,
      providerId,
      field,
      value: String(value).slice(0, 1000),
      sourceUrl: rec.sourceUrl,
      sourceRef: rec.externalKey,
      sourcePublishedAt: rec.sourcePublishedAt ?? null,
      observedAt: now,
    }));
  if (rows.length) await tx.insert(schema.sourceObservations).values(rows);

  // Contacts the source published.
  const contacts: { type: typeof schema.contactType.enumValues[number]; value: string; normalized: string }[] = [];
  const phone = normalizePhone(rec.phone);
  if (phone) contacts.push({ type: "phone", value: rec.phone!, normalized: phone });
  const email = normalizeEmail(rec.email);
  if (email) contacts.push({ type: "email", value: email, normalized: email });
  for (const s of rec.socials ?? []) contacts.push({ type: s.type, value: s.url, normalized: s.url.toLowerCase().replace(/\/$/, "") });
  if (contacts.length && !business.externalKeys.includes("suppressed")) {
    await tx
      .insert(schema.contacts)
      .values(contacts.map((c) => ({ businessId: business.id, type: c.type, value: c.value, normalizedValue: c.normalized, providerId, sourceUrl: rec.sourceUrl })))
      .onConflictDoNothing();
  }

  if (rec.domainObservation) await upsertDomain(tx, rec.domainObservation.domain, providerId, rec.domainObservation.sourceRef, business.id, rec.domainObservation.observedAt);
  else if (domain) await upsertDomain(tx, domain, providerId, rec.externalKey, business.id, null);

  return { business, created };
}

export async function upsertDomain(tx: Tx, domain: string, providerId: string, sourceRef: string | null, businessId: string | null, observedAt: Date | null) {
  const [row] = await tx
    .insert(schema.domains)
    .values({ domain, tld: tldOf(domain), businessId, discoveryProvider: providerId, sourceRef, firstDiscoveredAt: observedAt ?? new Date() })
    .onConflictDoUpdate({ target: schema.domains.domain, set: { businessId: sql`coalesce(${schema.domains.businessId}, excluded.business_id)`, updatedAt: new Date() } })
    .returning();
  return row;
}

export async function insertSignals(tx: Tx, workspaceId: string, businessId: string | null, providerId: string, signals: (DiscoveredSignal | DiscoveredUnattributedSignal)[]) {
  if (!signals.length) return 0;
  const res = await tx
    .insert(schema.businessSignals)
    .values(
      signals.map((s) => ({
        workspaceId,
        businessId,
        type: s.type,
        title: s.title,
        summary: s.summary ?? null,
        url: s.url ?? null,
        providerId,
        externalId: s.externalId,
        publishedAt: s.publishedAt ?? null,
        matchedKeywords: s.matchedKeywords ?? [],
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.businessSignals.id });
  return res.length;
}

/** Post-filter records against criteria the provider could not apply itself. Unknown values are kept (and scored lower). */
export function matchesCriteria(rec: DiscoveredRecord, c: RuleCriteria): boolean {
  if (c.countries?.length && rec.countryCode && !c.countries.includes(rec.countryCode)) return false;
  if (c.websiteState === "no_website" && rec.websiteUrl) return false;
  if (c.websiteState === "has_website" && !rec.websiteUrl) return false;
  if (c.industries?.length && rec.industry && !c.industries.some((i) => rec.industry!.toLowerCase().includes(i.toLowerCase()))) return false;
  if (c.businessTypes?.length && rec.businessType && !c.businessTypes.includes(rec.businessType)) return false;
  return true;
}

export type DiscoveryRunResult = {
  providerId: string;
  fetched: number;
  matched: number;
  newBusinesses: number;
  updatedBusinesses: number;
  duplicatesMerged: number;
  signals: number;
  businessIds: string[];
  notes: string[];
  requests: number;
};

/**
 * Steps 1–4 and 9 of the discovery workflow: fetch from an authorized source, normalize,
 * dedupe, match against criteria, and store with source + discovery time. Enrichment,
 * scoring and notifications run as follow-up jobs per business.
 */
export async function runDiscovery(workspaceId: string, providerId: string, criteria: RuleCriteria, opts: { since?: Date | null } = {}): Promise<DiscoveryRunResult> {
  const provider = getProvider(providerId);
  if (!provider?.discover) throw new Error(`${providerId} does not support discovery`);
  const ctx = await providerContext(workspaceId, providerId, opts.since ?? null);
  if (!ctx.enabled) throw new Error(`${provider.name} is disabled. Enable it on the Integrations page.`);
  if (!ctx.configured) throw new Error(`${provider.name} needs configuration (API key or settings) on the Integrations page.`);
  await consumeUsage(workspaceId, "discoveryRunsPerMonth");

  let result;
  try {
    result = await provider.discover(ctx, criteria);
    await recordProviderResult(workspaceId, providerId, { ok: true });
  } catch (e) {
    await recordProviderResult(workspaceId, providerId, { ok: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }

  const out: DiscoveryRunResult = { providerId, fetched: result.records.length, matched: 0, newBusinesses: 0, updatedBusinesses: 0, duplicatesMerged: 0, signals: 0, businessIds: [], notes: result.notes ?? [], requests: result.requests };
  const seen = new Set<string>();
  // Batch in chunks so a large run doesn't hold one huge transaction.
  const matched = result.records.filter((r) => matchesCriteria(r, criteria));
  out.matched = matched.length;
  for (let i = 0; i < matched.length; i += 50) {
    await withTenant(workspaceId, async (tx) => {
      for (const rec of matched.slice(i, i + 50)) {
        const { business, created } = await upsertBusiness(tx, rec, providerId);
        if (seen.has(business.id)) out.duplicatesMerged++;
        else {
          seen.add(business.id);
          out.businessIds.push(business.id);
          if (created) out.newBusinesses++;
          else out.updatedBusinesses++;
        }
        out.signals += await insertSignals(tx, workspaceId, business.id, providerId, rec.signals ?? []);
      }
    });
  }
  if (result.unattributedSignals?.length) {
    out.signals += await withTenant(workspaceId, (tx) => insertSignals(tx, workspaceId, null, providerId, result.unattributedSignals!));
  }
  return out;
}

/** Which of these businesses already have a lead in the workspace. */
export async function existingLeadMap(tx: Tx, workspaceId: string, businessIds: string[]) {
  if (!businessIds.length) return new Map<string, string>();
  const rows = await tx
    .select({ id: schema.leads.id, businessId: schema.leads.businessId })
    .from(schema.leads)
    .where(and(eq(schema.leads.workspaceId, workspaceId), inArray(schema.leads.businessId, businessIds)));
  return new Map(rows.map((r) => [r.businessId, r.id]));
}

