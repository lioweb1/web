import { assertOk, parseJson } from "./http";
import type { DiscoveredRecord, DiscoveredUnattributedSignal, ProviderDefinition } from "./types";
import { classifySignal } from "@/lib/discovery/classify";
import { normalizeUrl, registrableDomain, isPlatformDomain, cleanName } from "@/lib/discovery/normalize";

type Hit = { objectID: string; title?: string; url?: string | null; story_text?: string | null; comment_text?: string | null; created_at: string; created_at_i: number; _tags?: string[] };

const API = "https://hn.algolia.com/api/v1/search_by_date";

export function nameFromLaunchTitle(title: string, domain: string): string {
  const t = title.replace(/^(show|launch) hn:\s*/i, "");
  const m = t.match(/^([^–—:|,-]{2,60}?)\s*[–—:|,-]\s+/);
  return cleanName(m ? m[1] : t.length <= 40 && t.trim() ? t : domain);
}

export function mapHits(hits: Hit[]): { records: DiscoveredRecord[]; unattributed: DiscoveredUnattributedSignal[] } {
  const records: DiscoveredRecord[] = [];
  const unattributed: DiscoveredUnattributedSignal[] = [];
  for (const h of hits) {
    const title = h.title ?? (h.comment_text ?? "").replace(/<[^>]+>/g, " ").slice(0, 200);
    const text = `${title} ${(h.story_text ?? h.comment_text ?? "").replace(/<[^>]+>/g, " ")}`;
    const cls = classifySignal(text);
    const permalink = `https://news.ycombinator.com/item?id=${h.objectID}`;
    const signal = {
      type: cls.type,
      title: title.slice(0, 300),
      summary: (h.story_text ?? h.comment_text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || null,
      url: permalink,
      externalId: `hn:${h.objectID}`,
      publishedAt: new Date(h.created_at),
      matchedKeywords: cls.matched,
    };
    const site = normalizeUrl(h.url ?? null);
    const domain = registrableDomain(site);
    if (site && domain && !isPlatformDomain(domain)) {
      records.push({
        externalKey: `domain:${domain}`,
        name: nameFromLaunchTitle(title, domain),
        businessType: "Startup / product",
        websiteUrl: site,
        sourcePublishedAt: signal.publishedAt,
        sourceUrl: permalink,
        signals: [signal],
      });
    } else {
      unattributed.push({ ...signal, providerId: "hackernews" });
    }
  }
  return { records, unattributed };
}

export const hackerNewsProvider: ProviderDefinition = {
  id: "hackernews",
  name: "Hacker News launches & requests",
  category: "startup_signals",
  description: "Public 'Show HN' product launches and posts mentioning website needs, via the official HN Search API (Algolia).",
  docsUrl: "https://hn.algolia.com/api",
  pricingNote: "Free, no key. Fair-use rate limit (~10,000 requests/hour per IP).",
  licenseNote: "Public posts. Only the public post, its date and the linked website are stored.",
  refreshNote: "Periodic (hourly is fine). Search index updates within minutes.",
  updateMode: "periodic",
  minIntervalMinutes: 30,
  supportedCountries: "all",
  dataFields: ["post title", "post date", "linked website", "signal classification"],
  secretFields: [],
  settingFields: [],
  worksWithoutKey: true,
  reliability: 0.5,
  capabilities: { discovery: true, signals: true },
  criteriaSupport: ["keyword"],
  async test(ctx) {
    const res = await ctx.http(`${API}?tags=show_hn&hitsPerPage=1`, { timeoutMs: 15000, retries: 0 });
    return res.ok ? { ok: true, message: "HN Search API reachable" } : { ok: false, message: `HTTP ${res.status}` };
  },
  async discover(ctx, criteria) {
    const lookbackDays = Number(ctx.settings.lookbackDays ?? 7);
    const since = Math.floor((ctx.since ?? new Date(Date.now() - lookbackDays * 86400_000)).getTime() / 1000);
    const queries: { query: string; tags: string }[] = criteria.keyword
      ? [{ query: criteria.keyword, tags: "(story,show_hn)" }]
      : [
          { query: "", tags: "show_hn" },
          { query: "looking for web developer", tags: "(story,comment)" },
          { query: "need a website", tags: "(story,comment)" },
        ];
    const records: DiscoveredRecord[] = [];
    const unattributed: DiscoveredUnattributedSignal[] = [];
    for (const q of queries) {
      const params = new URLSearchParams({ query: q.query, tags: q.tags, numericFilters: `created_at_i>${since}`, hitsPerPage: "100" });
      const res = await ctx.http(`${API}?${params}`, { timeoutMs: 20000, minIntervalMs: 400 });
      assertOk(res, "HN Search API");
      const out = mapHits(parseJson<{ hits: Hit[] }>(res, "HN Search API").hits);
      records.push(...out.records);
      unattributed.push(...out.unattributed.filter((s) => s.type !== "general_update"));
    }
    return { records, unattributedSignals: unattributed, requests: queries.length, notes: ["Hacker News posts rarely include a location, so country targeting cannot be applied to these leads."] };
  },
};
