import { NEWS } from "./config.ts";

export interface NewsEvent {
  title: string;
  currency: string;
  time: number;
  impact: string;
}

let cache: { at: number; events: NewsEvent[] } | null = null;

/** High-impact events for this week from the ForexFactory calendar feed. Cached for 1 hour. */
export async function highImpactNews(): Promise<NewsEvent[]> {
  if (!NEWS.enabled) return [];
  if (cache && Date.now() - cache.at < 3600_000) return cache.events;
  try {
    const res = await fetch(NEWS.calendarUrl, {
      headers: { "User-Agent": "Mozilla/5.0 forex-signal-bot" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as Array<{ title: string; country: string; date: string; impact: string }>;
    const events = raw
      .filter((e) => e.impact === "High")
      .map((e) => ({ title: e.title, currency: e.country, time: Date.parse(e.date), impact: e.impact }))
      .filter((e) => !Number.isNaN(e.time));
    cache = { at: Date.now(), events };
    return events;
  } catch (err) {
    console.error(`News calendar unavailable (${(err as Error).message}); news filter skipped this round.`);
    return cache?.events ?? [];
  }
}

/** The high-impact event blocking this pair at `ms`, if any. */
export function blockingNews(events: NewsEvent[], currencies: string[], ms: number): NewsEvent | undefined {
  const w = NEWS.windowMinutes * 60_000;
  return events.find((e) => currencies.includes(e.currency) && Math.abs(e.time - ms) <= w);
}
