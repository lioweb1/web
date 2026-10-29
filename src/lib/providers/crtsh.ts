import { assertOk, parseJson, ProviderHttpError } from "./http";
import type { DiscoveredRecord, ProviderDefinition } from "./types";
import { countryFromCcTld, registrableDomain, isPlatformDomain } from "@/lib/discovery/normalize";

type CrtEntry = { id: number; name_value: string; common_name?: string; entry_timestamp?: string; not_before?: string; issuer_name?: string };

const HOSTING_SUFFIXES = /\.(herokuapp|vercel|netlify|github|pages|workers|azurewebsites|cloudfront|amazonaws|myshopify|wixsite|webflow|squarespace|blogspot|wordpress)\./i;

/**
 * Turn certificate-transparency log entries into newly observed domains. A new certificate
 * means a site is (being) set up on HTTPS; it is not proof of when the domain was registered.
 */
export function mapCrtEntries(entries: CrtEntry[], keyword: string, sinceMs: number): DiscoveredRecord[] {
  const byDomain = new Map<string, { first: Date; entry: CrtEntry; host: string }>();
  for (const e of entries) {
    const ts = new Date((e.entry_timestamp ?? e.not_before ?? "") + (e.entry_timestamp?.endsWith("Z") ? "" : "Z"));
    if (Number.isNaN(ts.getTime()) || ts.getTime() < sinceMs) continue;
    for (const name of e.name_value.split("\n")) {
      const host = name.trim().toLowerCase().replace(/^\*\./, "");
      if (HOSTING_SUFFIXES.test(`.${host}.`)) continue;
      const domain = registrableDomain(host);
      if (!domain || isPlatformDomain(domain) || !domain.includes(keyword.toLowerCase())) continue;
      const prev = byDomain.get(domain);
      if (!prev || ts < prev.first) byDomain.set(domain, { first: ts, entry: e, host });
    }
  }
  return [...byDomain.entries()].map(([domain, { first, entry }]) => {
    const cc = countryFromCcTld(domain);
    return {
      externalKey: `domain:${domain}`,
      name: domain,
      businessType: "Website / domain",
      countryCode: cc,
      countryEvidence: cc ? "ccTLD (weak evidence)" : null,
      websiteUrl: `https://${domain}`,
      sourcePublishedAt: first,
      sourceUrl: `https://crt.sh/?id=${entry.id}`,
      domainObservation: { domain, observedAt: first, sourceRef: `crt.sh:${entry.id}` },
      signals: [
        {
          type: "new_domain",
          title: `New TLS certificate logged for ${domain}`,
          summary: `Certificate issued by ${entry.issuer_name?.match(/O=([^,]+)/)?.[1] ?? "a public CA"}. Indicates a website being set up; not proof of registration date or intent.`,
          externalId: `crtsh:${domain}`,
          publishedAt: first,
          url: `https://crt.sh/?id=${entry.id}`,
          matchedKeywords: [keyword],
        },
      ],
    } satisfies DiscoveredRecord;
  });
}

export const crtshProvider: ProviderDefinition = {
  id: "crtsh",
  name: "Certificate Transparency (crt.sh)",
  category: "domain_intelligence",
  description: "Newly observed domains and websites from public Certificate Transparency logs. Search by keyword (e.g. 'bakery', 'dental') and TLD.",
  docsUrl: "https://crt.sh/",
  pricingNote: "Free public service operated by Sectigo. It can be slow or unavailable at peak times; keep keyword searches specific.",
  licenseNote: "Certificate Transparency logs are public by design (RFC 6962).",
  refreshNote: "Periodic. Certificates are logged within minutes of issuance; crt.sh indexes them with some delay.",
  updateMode: "periodic",
  minIntervalMinutes: 60,
  supportedCountries: "all",
  dataFields: ["domain", "first certificate date", "certificate issuer"],
  secretFields: [],
  settingFields: [],
  worksWithoutKey: true,
  reliability: 0.5,
  capabilities: { discovery: true },
  criteriaSupport: ["keyword", "tlds", "countries"],
  async test(ctx) {
    const res = await ctx.http("https://crt.sh/?q=example.com&output=json&exclude=expired", { timeoutMs: 30000, retries: 0 });
    return res.ok ? { ok: true, message: "crt.sh reachable" } : { ok: false, message: `crt.sh returned HTTP ${res.status}` };
  },
  async discover(ctx, criteria) {
    const keyword = criteria.keyword?.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!keyword || keyword.length < 4) throw new ProviderHttpError("Certificate Transparency search needs a keyword of at least 4 letters (e.g. 'bakery').", 400, false);
    const tlds = (criteria.tlds?.length ? criteria.tlds : ["com"]).map((t) => t.replace(/^\./, "").toLowerCase()).slice(0, 5);
    const lookbackDays = Number(ctx.settings.lookbackDays ?? 7);
    const sinceMs = (ctx.since ?? new Date(Date.now() - lookbackDays * 86400_000)).getTime();
    const records: DiscoveredRecord[] = [];
    let requests = 0;
    for (const tld of tlds) {
      const res = await ctx.http(`https://crt.sh/?${new URLSearchParams({ q: `%${keyword}%.${tld}`, output: "json", exclude: "expired" })}`, {
        timeoutMs: 90_000,
        minIntervalMs: 3000,
        maxBytes: 30_000_000,
      });
      requests++;
      assertOk(res, "crt.sh");
      records.push(...mapCrtEntries(res.text.trim() ? parseJson<CrtEntry[]>(res, "crt.sh") : [], keyword, sinceMs));
    }
    const filtered = criteria.countries?.length ? records.filter((r) => !r.countryCode || criteria.countries!.includes(r.countryCode)) : records;
    return { records: filtered, requests, notes: ["Country is only inferred from country-code TLDs (weak evidence); generic TLDs have no country."] };
  },
};
