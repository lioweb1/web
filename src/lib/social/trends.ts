import { assertOk, parseJson, type HttpClient } from "@/lib/providers/http";
import { parseFeed } from "@/lib/providers/rss";
import { safeFetch, type Resolver } from "@/lib/analysis/net";
import { sha256 } from "@/lib/security/crypto";
import type { SocialAutopilotConfig } from "@/lib/db/schema";
import { blueskySession } from "./publish";
import type { Connection } from "./accounts";

/** Free, official trend sources. Nothing here logs in to or scrapes a social network's website. */
export const TREND_SOURCES = [
  { id: "hackernews", name: "Hacker News", note: "Algolia search API. No key." },
  { id: "google_news", name: "Google News", note: "Public search RSS feed. No key." },
  { id: "reddit", name: "Reddit", note: "Public subreddit RSS feeds. No key." },
  { id: "bluesky", name: "Bluesky", note: "Post search. Uses your Bluesky connection." },
  { id: "rss", name: "Your RSS feeds", note: "Any blogs or news sites you list." },
] as const;

export type TrendItem = {
  sourceId: string;
  externalId: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: Date | null;
  /** Points/likes/comments where the source reports them. */
  engagement: number;
};

export type TrendDeps = { http: HttpClient; resolve: Resolver; bluesky?: Connection | null };

const strip = (s: string | null | undefined) => (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export function matchesKeywords(text: string, keywords: string[]) {
  const t = text.toLowerCase();
  return keywords.filter((k) => t.includes(k.toLowerCase()));
}

async function hackerNews(d: TrendDeps, keywords: string[], since: Date): Promise<TrendItem[]> {
  const out: TrendItem[] = [];
  for (const kw of keywords.slice(0, 5)) {
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=30&query=${encodeURIComponent(kw)}&numericFilters=created_at_i>${Math.floor(since.getTime() / 1000)}`;
    const res = await d.http(url, { timeoutMs: 20_000, minIntervalMs: 500 });
    assertOk(res, "Hacker News");
    const data = parseJson<{ hits: { objectID: string; title?: string; url?: string | null; story_text?: string | null; created_at: string; points?: number; num_comments?: number }[] }>(res, "Hacker News");
    for (const h of data.hits) {
      if (!h.title) continue;
      out.push({ sourceId: "hackernews", externalId: `hn:${h.objectID}`, title: h.title, summary: strip(h.story_text).slice(0, 800) || null, url: `https://news.ycombinator.com/item?id=${h.objectID}`, publishedAt: new Date(h.created_at), engagement: (h.points ?? 0) + (h.num_comments ?? 0) });
    }
  }
  return out;
}

async function feedItems(d: TrendDeps, sourceId: string, url: string, opts: { safe?: boolean } = {}): Promise<TrendItem[]> {
  const res = opts.safe ? await safeFetch(d.http, d.resolve, url, { timeoutMs: 20_000, minIntervalMs: 1000 }) : await d.http(url, { timeoutMs: 20_000, minIntervalMs: 1000 });
  assertOk(res, sourceId === "rss" ? "Feed" : sourceId);
  return parseFeed(res.text).map((i) => ({
    sourceId,
    externalId: `${sourceId}:${sha256(`${url}|${i.guid}`).slice(0, 32)}`,
    title: strip(i.title),
    summary: i.summary || null,
    url: i.link,
    publishedAt: i.published,
    engagement: 0,
  }));
}

async function googleNews(d: TrendDeps, keywords: string[]) {
  const out: TrendItem[] = [];
  for (const kw of keywords.slice(0, 5)) out.push(...(await feedItems(d, "google_news", `https://news.google.com/rss/search?q=${encodeURIComponent(`${kw} when:2d`)}&hl=en-US&gl=US&ceid=US:en`)));
  return out;
}

async function reddit(d: TrendDeps, subreddits: string[], keywords: string[]) {
  const out: TrendItem[] = [];
  const subs = subreddits.map((s) => s.replace(/^\/?r\//i, "").trim()).filter((s) => /^[A-Za-z0-9_]{2,30}$/.test(s));
  if (subs.length) for (const s of subs.slice(0, 10)) out.push(...(await feedItems(d, "reddit", `https://www.reddit.com/r/${s}/new/.rss`)));
  else for (const kw of keywords.slice(0, 3)) out.push(...(await feedItems(d, "reddit", `https://www.reddit.com/search.rss?sort=new&t=day&q=${encodeURIComponent(kw)}`)));
  return out;
}

async function bluesky(d: TrendDeps, keywords: string[], since: Date) {
  if (!d.bluesky?.configured) throw new Error("Connect Bluesky (handle + app password) to search it for trends");
  const session = await blueskySession(d.http, d.bluesky);
  const out: TrendItem[] = [];
  for (const kw of keywords.slice(0, 5)) {
    const res = await d.http(`${session.service}/xrpc/app.bsky.feed.searchPosts?sort=top&limit=25&since=${encodeURIComponent(since.toISOString())}&q=${encodeURIComponent(kw)}`, {
      headers: { Authorization: `Bearer ${session.accessJwt}` },
      timeoutMs: 20_000,
      minIntervalMs: 500,
    });
    assertOk(res, "Bluesky");
    const data = parseJson<{ posts: { uri: string; author: { handle: string }; record: { text?: string; createdAt?: string }; likeCount?: number; repostCount?: number; replyCount?: number }[] }>(res, "Bluesky");
    for (const p of data.posts) {
      const text = p.record.text?.trim();
      if (!text) continue;
      out.push({
        sourceId: "bluesky",
        externalId: `bsky:${sha256(p.uri).slice(0, 32)}`,
        title: text.slice(0, 200),
        summary: text,
        url: `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split("/").pop()}`,
        publishedAt: p.record.createdAt ? new Date(p.record.createdAt) : null,
        engagement: (p.likeCount ?? 0) + 2 * (p.repostCount ?? 0) + (p.replyCount ?? 0),
      });
    }
  }
  return out;
}

/**
 * Fetch candidate items from every enabled source, keep those that mention a niche keyword and
 * are recent, and rank them by keyword hits, engagement and freshness. Source errors are collected,
 * not thrown, so one broken source does not stop the others.
 */
export async function fetchTrends(d: TrendDeps, cfg: SocialAutopilotConfig, now = new Date()) {
  const since = new Date(now.getTime() - 2 * 86400_000);
  const items: TrendItem[] = [];
  const errors: string[] = [];
  const run = async (id: string, fn: () => Promise<TrendItem[]>) => {
    if (!cfg.sources.includes(id)) return;
    try {
      items.push(...(await fn()));
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await run("hackernews", () => hackerNews(d, cfg.keywords, since));
  await run("google_news", () => googleNews(d, cfg.keywords));
  await run("reddit", () => reddit(d, cfg.subreddits, cfg.keywords));
  await run("bluesky", () => bluesky(d, cfg.keywords, since));
  await run("rss", async () => {
    const all: TrendItem[] = [];
    for (const f of cfg.feeds.slice(0, 20)) all.push(...(await feedItems(d, "rss", f, { safe: true })));
    return all;
  });
  return { items: rankTrends(items, cfg.keywords, now, since), fetched: items.length, errors };
}

export function rankTrends(items: TrendItem[], keywords: string[], now: Date, since: Date) {
  const seen = new Set<string>();
  const scored: { item: TrendItem; score: number }[] = [];
  for (const item of items) {
    if (seen.has(item.externalId) || !item.title) continue;
    seen.add(item.externalId);
    if (item.publishedAt && item.publishedAt < since) continue;
    const hits = keywords.length ? matchesKeywords(`${item.title} ${item.summary ?? ""}`, keywords).length : 1;
    if (!hits) continue;
    const ageHours = item.publishedAt ? Math.max(0, (now.getTime() - item.publishedAt.getTime()) / 3600_000) : 24;
    scored.push({ item, score: hits * 10 + Math.log10(1 + item.engagement) * 8 - ageHours * 0.3 });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.item);
}
