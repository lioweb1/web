import { assertOk, parseJson, ProviderHttpError } from "./http";
import type { DiscoveredRecord, ProviderContext, ProviderDefinition } from "./types";

const BASE = "https://api.company-information.service.gov.uk";

/** SIC 2007 section mapping (by 2-digit division) to readable industries. */
const SIC_DIVISIONS: [number, number, string][] = [
  [1, 3, "Agriculture"], [5, 9, "Mining & Energy"], [10, 33, "Manufacturing"], [35, 39, "Utilities"],
  [41, 43, "Construction & Trades"], [45, 47, "Retail"], [49, 53, "Transport & Logistics"], [55, 56, "Hospitality"],
  [58, 63, "Technology & Media"], [64, 66, "Finance"], [68, 68, "Real Estate"], [69, 75, "Professional Services"],
  [77, 82, "Business Services"], [84, 84, "Public Sector"], [85, 85, "Education"], [86, 88, "Healthcare"],
  [90, 93, "Arts & Recreation"], [94, 96, "Other Services"],
];

export function industryFromSic(codes: string[] | undefined): string | null {
  const code = codes?.[0];
  if (!code) return null;
  const div = Number(code.slice(0, 2));
  return SIC_DIVISIONS.find(([a, b]) => div >= a && div <= b)?.[2] ?? null;
}

type CHItem = {
  company_name: string;
  company_number: string;
  company_status?: string;
  company_type?: string;
  date_of_creation?: string;
  sic_codes?: string[];
  registered_office_address?: { address_line_1?: string; address_line_2?: string; locality?: string; postal_code?: string; region?: string; country?: string };
};

function authHeader(ctx: ProviderContext) {
  const key = ctx.secrets.apiKey;
  if (!key) throw new ProviderHttpError("Companies House API key is not configured (free at developer.company-information.service.gov.uk).", 401, false);
  return { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
}

export function mapCompany(item: CHItem): DiscoveredRecord {
  const a = item.registered_office_address ?? {};
  return {
    externalKey: `companies_house:${item.company_number}`,
    name: item.company_name,
    industry: industryFromSic(item.sic_codes),
    category: item.sic_codes?.length ? `SIC ${item.sic_codes.join(", ")}` : null,
    businessType: item.company_type === "ltd" ? "Private limited company" : (item.company_type ?? "Company"),
    countryCode: "GB",
    countryEvidence: "UK company register",
    region: a.region ?? a.country ?? null,
    city: a.locality ?? null,
    address: [a.address_line_1, a.address_line_2].filter(Boolean).join(", ") || null,
    postcode: a.postal_code ?? null,
    registrationDate: item.date_of_creation ?? null,
    sourcePublishedAt: item.date_of_creation ? new Date(item.date_of_creation) : null,
    sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${item.company_number}`,
    signals: item.date_of_creation
      ? [
          {
            type: "new_registration",
            title: `Incorporated on ${item.date_of_creation} (Companies House)`,
            summary: "Registered company incorporation date from the official UK register. A website is not listed in the register.",
            externalId: `companies_house:${item.company_number}:incorporated`,
            publishedAt: new Date(item.date_of_creation),
            url: `https://find-and-update.company-information.service.gov.uk/company/${item.company_number}`,
          },
        ]
      : [],
  };
}

export const companiesHouseProvider: ProviderDefinition = {
  id: "companies_house",
  name: "UK Companies House",
  category: "company_registry",
  description: "Official register of UK companies. Finds newly incorporated companies with verified incorporation dates, industry (SIC) and registered address.",
  docsUrl: "https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference",
  pricingNote: "Free. Requires a free API key. Limit: 600 requests per 5 minutes.",
  licenseNote: "Crown copyright, Open Government Licence v3.0.",
  refreshNote: "Periodic (daily recommended). The register updates continuously; incorporations appear within a day.",
  updateMode: "periodic",
  minIntervalMinutes: 60,
  supportedCountries: ["GB"],
  dataFields: ["company name", "company number", "incorporation date", "status", "SIC industry", "registered address"],
  secretFields: [{ key: "apiKey", label: "REST API key", type: "secret", required: true, help: "Create an application at developer.company-information.service.gov.uk and add a REST key." }],
  settingFields: [],
  worksWithoutKey: false,
  reliability: 1,
  capabilities: { discovery: true },
  criteriaSupport: ["keyword", "cities"],
  async test(ctx) {
    const res = await ctx.http(`${BASE}/search/companies?q=test&items_per_page=1`, { headers: authHeader(ctx), retries: 0, timeoutMs: 15000 });
    if (!res.ok) return { ok: false, message: res.status === 401 ? "API key rejected (HTTP 401)" : `HTTP ${res.status}` };
    const remaining = Number(res.headers.get("x-ratelimit-remain"));
    return { ok: true, message: "Companies House API key accepted", remainingQuota: Number.isFinite(remaining) ? remaining : null };
  },
  async discover(ctx, criteria) {
    if (criteria.countries?.length && !criteria.countries.includes("GB")) {
      return { records: [], requests: 0, notes: ["Companies House only covers the United Kingdom; GB is not in this search's countries."] };
    }
    const lookbackDays = Number(ctx.settings.lookbackDays ?? 14);
    const from = ctx.since ?? new Date(Date.now() - lookbackDays * 86400_000);
    const params = new URLSearchParams({
      incorporated_from: from.toISOString().slice(0, 10),
      incorporated_to: new Date().toISOString().slice(0, 10),
      company_status: "active",
      size: String(Math.min(Number(ctx.settings.maxResults ?? 200), 1000)),
    });
    if (criteria.keyword) params.set("company_name_includes", criteria.keyword);
    if (criteria.cities?.length === 1) params.set("location", criteria.cities[0]);
    const res = await ctx.http(`${BASE}/advanced-search/companies?${params}`, { headers: authHeader(ctx), timeoutMs: 30000, minIntervalMs: 500 });
    if (res.status === 404) return { records: [], requests: 1, notes: ["No companies incorporated in that window matched."] };
    assertOk(res, "Companies House");
    const data = parseJson<{ items?: CHItem[]; hits?: number }>(res, "Companies House");
    const records = (data.items ?? []).map(mapCompany);
    const notes = [`Incorporations from ${from.toISOString().slice(0, 10)}. ${data.hits ?? records.length} total matches.`];
    if (criteria.cities && criteria.cities.length > 1) notes.push("Companies House location filter supports one city per search; other cities were ignored.");
    return { records, notes, requests: 1 };
  },
};
