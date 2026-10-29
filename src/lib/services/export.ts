import { schema, withTenant } from "@/lib/db";
import { searchLeads, type LeadFilters, type LeadRow, filtersToQuery } from "./leads";
import { consumeUsage } from "@/lib/plans";
import { countryName } from "@/lib/countries";
import { statusLabel } from "@/lib/lead-constants";
import { scoreCategory } from "@/lib/scoring/score";
import { sourceName } from "@/lib/providers/registry";
import { primaryPlatform } from "@/lib/analysis/detect";

const d = (v: Date | string | null | undefined) => (v ? (typeof v === "string" ? v : v.toISOString()) : "");

export const EXPORT_FIELDS: { key: string; label: string; get: (r: LeadRow) => string | number | null | undefined; default?: boolean }[] = [
  { key: "name", label: "Business name", get: (r) => r.business.name, default: true },
  { key: "website", label: "Website", get: (r) => r.business.websiteUrl, default: true },
  { key: "domain", label: "Domain", get: (r) => r.business.domain },
  { key: "email", label: "Email", get: (r) => r.email?.value, default: true },
  { key: "email_status", label: "Email verification status", get: (r) => r.email?.verificationStatus, default: true },
  { key: "phone", label: "Phone", get: (r) => r.phone?.value, default: true },
  { key: "linkedin", label: "LinkedIn page", get: (r) => r.contacts.find((c) => c.type === "linkedin")?.value },
  { key: "facebook", label: "Facebook page", get: (r) => r.contacts.find((c) => c.type === "facebook")?.value },
  { key: "contact_page", label: "Contact page", get: (r) => r.contacts.find((c) => c.type === "contact_page")?.value },
  { key: "country", label: "Country", get: (r) => (r.business.countryCode ? countryName(r.business.countryCode) : ""), default: true },
  { key: "country_code", label: "Country code", get: (r) => r.business.countryCode },
  { key: "region", label: "Region", get: (r) => r.business.region },
  { key: "city", label: "City", get: (r) => r.business.city, default: true },
  { key: "address", label: "Address", get: (r) => r.business.address },
  { key: "postcode", label: "Postcode", get: (r) => r.business.postcode },
  { key: "industry", label: "Industry", get: (r) => r.business.industry, default: true },
  { key: "category", label: "Category", get: (r) => r.business.category },
  { key: "business_type", label: "Business type", get: (r) => r.business.businessType },
  { key: "score", label: "Lead score", get: (r) => r.lead.score, default: true },
  { key: "score_category", label: "Score category", get: (r) => scoreCategory(r.lead.score) },
  { key: "score_confidence", label: "Score confidence", get: (r) => r.lead.scoreConfidence },
  { key: "status", label: "Status", get: (r) => statusLabel(r.lead.status), default: true },
  { key: "priority", label: "Priority", get: (r) => r.lead.priority },
  { key: "tags", label: "Tags", get: (r) => r.tags.map((t) => t.name).join("; ") },
  { key: "cms", label: "CMS / platform", get: (r) => (r.analysis ? primaryPlatform(r.analysis.technologies) : "") },
  { key: "technologies", label: "Detected technologies", get: (r) => r.analysis?.technologies.map((t) => t.name).join("; ") },
  { key: "issues", label: "Website issues", get: (r) => r.analysis?.issues.map((i) => i.label).join("; ") },
  { key: "registration_date", label: "Registration date (registry)", get: (r) => r.business.registrationDate },
  { key: "source", label: "Discovery source", get: (r) => sourceName(r.lead.discoveryProvider) },
  { key: "discovered_at", label: "Discovered (by LeadOrbit)", get: (r) => d(r.lead.createdAt), default: true },
  { key: "last_verified_at", label: "Last verified", get: (r) => d(r.business.lastVerifiedAt) },
  { key: "follow_up_at", label: "Follow-up date", get: (r) => d(r.lead.followUpAt) },
  { key: "lead_id", label: "LeadOrbit lead ID", get: (r) => r.lead.id },
];

/** Neutralize spreadsheet formula injection (CSV injection). */
export function escapeCell(v: unknown, delimiter: string): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes('"') || s.includes(delimiter) || /[\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: LeadRow[], fieldKeys: string[], opts: { delimiter: "," | ";"; bom: boolean }) {
  const fields = fieldKeys.map((k) => EXPORT_FIELDS.find((f) => f.key === k)).filter((f): f is (typeof EXPORT_FIELDS)[number] => !!f);
  const lines = [fields.map((f) => escapeCell(f.label, opts.delimiter)).join(opts.delimiter)];
  for (const r of rows) lines.push(fields.map((f) => escapeCell(f.get(r), opts.delimiter)).join(opts.delimiter));
  return (opts.bom ? "﻿" : "") + lines.join("\r\n") + "\r\n";
}

export type ContactFilter = "any" | "email" | "phone" | "email_or_phone";

export async function buildExport(workspaceId: string, userId: string, filters: LeadFilters, opts: { fields: string[]; contact: ContactFilter; format: "csv" | "excel"; delimiter?: "," | ";" }) {
  const fields = opts.fields.filter((k) => EXPORT_FIELDS.some((f) => f.key === k));
  if (!fields.length) throw new Error("Select at least one field to export.");
  const f: LeadFilters = { ...filters, page: 1 };
  if (opts.contact === "email") f.hasEmail = true;
  if (opts.contact === "phone") f.hasPhone = true;
  let { rows } = await searchLeads(workspaceId, f, { all: true });
  if (opts.contact === "email_or_phone") rows = rows.filter((r) => r.email || r.phone);
  if (!rows.length) throw new Error("No leads match these filters — nothing to export.");
  await consumeUsage(workspaceId, "exportRowsPerMonth", rows.length);
  const csv = toCsv(rows, fields, { delimiter: opts.delimiter ?? ",", bom: opts.format === "excel" });
  await withTenant(workspaceId, (tx) =>
    tx.insert(schema.exportsLog).values({ workspaceId, userId, format: opts.format, rowCount: rows.length, fields, filters: [filtersToQuery(filters), opts.contact !== "any" ? `contact=${opts.contact}` : ""].filter(Boolean).join("&") }),
  );
  return { csv, rowCount: rows.length };
}
