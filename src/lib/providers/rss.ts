import * as cheerio from "cheerio";
import { assertOk, ProviderHttpError } from "./http";
import type { DiscoveredUnattributedSignal, ProviderDefinition } from "./types";
import { classifySignal } from "@/lib/discovery/classify";
import { sha256 } from "@/lib/security/crypto";

export type FeedItem = { title: string; link: string | null; summary: string; published: Date | null; guid: string };

export function parseFeed(xml: string): FeedItem[] {
  const $ = cheerio.load(xml, { xml: true });
  const items: FeedItem[] = [];
  $("item, entry").each((_, el) => {
    const n = $(el);
    const title = n.children("title").first().text().trim();
    const link = n.children("link").first().attr("href") ?? (n.children("link").first().text().trim() || null);
    const summary = cheerio.load(n.children("description, summary, content").first().text()).text().replace(/\s+/g, " ").trim();
    const dateText = n.children("pubDate, published, updated, dc\\:date").first().text().trim();
    const d = dateText ? new Date(dateText) : null;
    const guid = n.children("guid, id").first().text().trim() || link || title;
    if (title) items.push({ title, link, summary: summary.slice(0, 800), published: d && !Number.isNaN(d.getTime()) ? d : null, guid });
  });
  return items;
}

export const rssProvider: ProviderDefinition = {
  id: "rss",
  name: "RSS / Atom feeds",
  category: "news_feeds",
  description:
    "Monitor public feeds you choose — press-release wires, local business news, startup blogs, job boards — and classify items as launches, website requests, redesigns or expansion news.",
  docsUrl: "https://www.rssboard.org/rss-specification",
  pricingNote: "Free. Respect each feed publisher's terms.",
  licenseNote: "Only the item title, link, date and a short excerpt are stored.",
  refreshNote: "Periodic. Feeds are polled on your rule's schedule.",
  updateMode: "periodic",
  minIntervalMinutes: 15,
  supportedCountries: "all",
  dataFields: ["item title", "link", "publication date", "signal classification"],
  secretFields: [],
  settingFields: [{ key: "feeds", label: "Feed URLs", type: "textarea", help: "One feed URL per line.", required: true }],
  worksWithoutKey: true,
  reliability: 0.4,
  capabilities: { discovery: true, signals: true },
  criteriaSupport: ["keyword"],
  async test(ctx) {
    const feeds = feedList(ctx.settings);
    if (!feeds.length) return { ok: false, message: "Add at least one feed URL in settings." };
    const res = await ctx.http(feeds[0], { timeoutMs: 15000, retries: 0 });
    if (!res.ok) return { ok: false, message: `${feeds[0]} returned HTTP ${res.status}` };
    return { ok: true, message: `Feed parsed: ${parseFeed(res.text).length} items` };
  },
  async discover(ctx, criteria) {
    const feeds = feedList(ctx.settings);
    if (!feeds.length) throw new ProviderHttpError("No RSS feeds configured. Add feed URLs on the Integrations page.", 400, false);
    const since = ctx.since?.getTime() ?? Date.now() - 14 * 86400_000;
    const kw = criteria.keyword?.toLowerCase();
    const signals: DiscoveredUnattributedSignal[] = [];
    const notes: string[] = [];
    for (const url of feeds.slice(0, 30)) {
      try {
        const res = await ctx.http(url, { timeoutMs: 20000, minIntervalMs: 1000 });
        assertOk(res, "Feed");
        for (const item of parseFeed(res.text)) {
          if (item.published && item.published.getTime() < since) continue;
          const text = `${item.title} ${item.summary}`;
          if (kw && !text.toLowerCase().includes(kw)) continue;
          const cls = classifySignal(text);
          if (!kw && cls.matched.length === 0) continue;
          signals.push({
            providerId: "rss",
            type: cls.type,
            title: item.title.slice(0, 300),
            summary: item.summary || null,
            url: item.link,
            externalId: `rss:${sha256(`${url}|${item.guid}`).slice(0, 32)}`,
            publishedAt: item.published,
            matchedKeywords: kw ? [kw, ...cls.matched] : cls.matched,
          });
        }
      } catch (err) {
        notes.push(`Feed ${url} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { records: [], unattributedSignals: signals, requests: feeds.length, notes };
  },
};

function feedList(settings: Record<string, unknown>): string[] {
  return String(settings.feeds ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s));
}
