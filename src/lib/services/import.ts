import Papa from "papaparse";
import { eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import type { DiscoveredRecord } from "@/lib/providers/types";
import { schema, withTenant } from "@/lib/db";
import { findDuplicate } from "@/lib/discovery/pipeline";
import { cleanName, normalizeCountry, normalizeEmail, normalizeName, normalizePhone, normalizeUrl, registrableDomain } from "@/lib/discovery/normalize";
import { createLead, ensureTag } from "./leads";
import { enqueue } from "@/lib/jobs/queue";
import { computeScore } from "./enrich";
import { LimitExceededError } from "@/lib/plans";

export const IMPORT_FIELDS = [
  { key: "name", label: "Business name", required: true },
  { key: "website", label: "Website" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "industry", label: "Industry" },
  { key: "category", label: "Category" },
  { key: "notes", label: "Notes" },
  { key: "tags", label: "Tags (comma/semicolon separated)" },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
export type ColumnMapping = Partial<Record<ImportField, string>>;

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const headers = (res.meta.fields ?? []).filter(Boolean);
  return { headers, rows: res.data };
}

const GUESSES: Record<ImportField, RegExp> = {
  name: /^(business|company|organi[sz]ation)?\s*name$|^company$|^business$/i,
  website: /web|url|site|domain/i,
  email: /e-?mail/i,
  phone: /phone|tel|mobile/i,
  city: /city|town|locality/i,
  country: /country/i,
  industry: /industry|sector/i,
  category: /category|type/i,
  notes: /note|comment|description/i,
  tags: /tag|label/i,
};

/** Best-effort default mapping from header names. */
export function guessMapping(headers: string[]): ColumnMapping {
  const m: ColumnMapping = {};
  for (const f of IMPORT_FIELDS) {
    const h = headers.find((x) => GUESSES[f.key].test(x) && !Object.values(m).includes(x));
    if (h) m[f.key] = h;
  }
  return m;
}

export type ImportResult = { total: number; created: number; duplicates: number; invalid: number; errors: { row: number; message: string }[]; limitReached: boolean };

/**
 * Import CSV rows as private businesses + leads in a workspace. Rows are deduped against
 * the workspace's visible businesses (domain, then name+country+city) and within the file.
 */
export async function importLeads(workspaceId: string, actorId: string, text: string, mapping: ColumnMapping, opts: { tags?: string[]; enrich?: boolean } = {}): Promise<ImportResult> {
  if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) throw new Error("File is larger than 5 MB.");
  if (!mapping.name) throw new Error("Map a column to Business name.");
  const { rows } = parseCsv(text);
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`File has ${rows.length} rows; the maximum is ${MAX_IMPORT_ROWS}.`);
  const result: ImportResult = { total: rows.length, created: 0, duplicates: 0, invalid: 0, errors: [], limitReached: false };
  const get = (r: Record<string, string>, f: ImportField) => (mapping[f] ? (r[mapping[f]!] ?? "").trim() : "");
  const enrichIds: string[] = [];
  const seenInFile = new Set<string>();

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await withTenant(workspaceId, async (tx) => {
      const commonTags = await Promise.all((opts.tags ?? []).filter(Boolean).map((t) => ensureTag(tx, workspaceId, t)));
      for (let j = 0; j < chunk.length; j++) {
        const rowNo = i + j + 2; // header is row 1
        const r = chunk[j];
        const name = cleanName(get(r, "name"));
        if (!name) {
          result.invalid++;
          result.errors.push({ row: rowNo, message: "Missing business name" });
          continue;
        }
        const rawSite = get(r, "website");
        const websiteUrl = normalizeUrl(rawSite);
        if (rawSite && !websiteUrl) result.errors.push({ row: rowNo, message: `Website "${rawSite.slice(0, 60)}" is not a valid URL; ignored` });
        const rawEmail = get(r, "email");
        const email = normalizeEmail(rawEmail);
        if (rawEmail && !email) result.errors.push({ row: rowNo, message: `Email "${rawEmail.slice(0, 60)}" is invalid; ignored` });
        const countryRaw = get(r, "country");
        const countryCode = normalizeCountry(countryRaw);
        if (countryRaw && !countryCode) result.errors.push({ row: rowNo, message: `Unknown country "${countryRaw.slice(0, 40)}"; ignored` });
        const city = get(r, "city") || null;
        const domain = registrableDomain(websiteUrl);
        const key = domain ?? `${normalizeName(name)}|${countryCode ?? ""}|${(city ?? "").toLowerCase()}`;
        if (seenInFile.has(key)) {
          result.duplicates++;
          continue;
        }
        seenInFile.add(key);

        const existing = await findDuplicate(tx, { domain, normalizedName: normalizeName(name), countryCode, city });
        if (existing) {
          const [lead] = await tx.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.businessId, existing.id));
          if (lead) {
            result.duplicates++;
            continue;
          }
        }
        const rec = {
          externalKey: domain ? `domain:${domain}` : `csv:${workspaceId}:${key}`,
          name,
          websiteUrl,
          email,
          phone: normalizePhone(get(r, "phone")) ? get(r, "phone") : null,
          city,
          countryCode,
          countryEvidence: countryCode ? "CSV import" : null,
          industry: get(r, "industry") || null,
          category: get(r, "category") || null,
          sourceUrl: "",
        };
        // Imported data stays private: never write it onto a shared public record.
        // Private businesses never create shared domain rows, so they can't affect other workspaces.
        const business = existing && existing.ownerWorkspaceId === workspaceId ? existing : await insertPrivateBusiness(tx, workspaceId, rec);
        if (business === existing) await addPrivateContacts(tx, business.id, rec);
        let lead;
        try {
          ({ lead } = await createLead(tx, workspaceId, business.id, { actorId, providerId: "csv_import", summary: "Imported from CSV" }));
        } catch (e) {
          if (e instanceof LimitExceededError) {
            result.limitReached = true;
            result.errors.push({ row: rowNo, message: e.message });
            return;
          }
          throw e;
        }
        result.created++;
        const score = await computeScore(tx, workspaceId, business.id);
        await tx
          .update(schema.leads)
          .set({ score: score.score, scoreFactors: score.factors, scoreConfidence: score.confidence, scoreMissing: score.missing, scoreNextStep: score.nextStep, scoredAt: new Date() })
          .where(eq(schema.leads.id, lead.id));
        const rowTags = get(r, "tags")
          .split(/[;,]/)
          .map((t) => t.trim())
          .filter(Boolean);
        const tags = [...commonTags, ...(await Promise.all(rowTags.map((t) => ensureTag(tx, workspaceId, t))))];
        if (tags.length) await tx.insert(schema.leadTags).values(tags.map((t) => ({ workspaceId, leadId: lead.id, tagId: t.id }))).onConflictDoNothing();
        const note = get(r, "notes");
        if (note) await tx.insert(schema.notes).values({ workspaceId, leadId: lead.id, authorId: actorId, body: note.slice(0, 5000) });
        enrichIds.push(lead.id);
      }
    });
    if (result.limitReached) break;
  }
  if (opts.enrich !== false) {
    for (const id of enrichIds) await enqueue({ type: "enrich_lead", workspaceId, payload: { leadId: id }, idempotencyKey: `enrich:import:${id}` });
  }
  return result;
}

/** A private copy for a row that matches a shared public business (contacts stay workspace-private). */
async function insertPrivateBusiness(tx: Tx, workspaceId: string, rec: DiscoveredRecord) {
  const [business] = await tx
    .insert(schema.businesses)
    .values({
      ownerWorkspaceId: workspaceId,
      name: rec.name,
      normalizedName: normalizeName(rec.name) || rec.name.toLowerCase(),
      websiteUrl: rec.websiteUrl ?? null,
      domain: registrableDomain(rec.websiteUrl),
      hasWebsite: rec.websiteUrl ? true : null,
      city: rec.city ?? null,
      countryCode: rec.countryCode ?? null,
      industry: rec.industry ?? null,
      category: rec.category ?? null,
      externalKeys: [`csv:${workspaceId}:${rec.externalKey}`],
      lastVerifiedAt: new Date(),
    })
    .returning();
  await addPrivateContacts(tx, business.id, rec);
  const fields: [string, string | null | undefined][] = [["name", rec.name], ["websiteUrl", rec.websiteUrl], ["email", rec.email], ["phone", rec.phone], ["city", rec.city], ["countryCode", rec.countryCode], ["industry", rec.industry], ["category", rec.category]];
  const obs = fields.filter(([, v]) => v).map(([field, value]) => ({ businessId: business.id, providerId: "csv_import", field, value: String(value), sourceRef: "CSV import" }));
  if (obs.length) await tx.insert(schema.sourceObservations).values(obs);
  return business;
}

async function addPrivateContacts(tx: Tx, businessId: string, rec: DiscoveredRecord) {
  const contacts: { type: "email" | "phone"; value: string; normalizedValue: string }[] = [];
  const email = normalizeEmail(rec.email);
  if (email) contacts.push({ type: "email", value: email, normalizedValue: email });
  const phone = normalizePhone(rec.phone);
  if (phone) contacts.push({ type: "phone", value: rec.phone!, normalizedValue: phone });
  if (contacts.length) await tx.insert(schema.contacts).values(contacts.map((c) => ({ ...c, businessId, providerId: "csv_import", sourceUrl: null }))).onConflictDoNothing();
}
