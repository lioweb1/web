import type { Candle } from "./types.ts";

const INTERVAL_MS: Record<string, number> = { "5m": 5 * 60_000, "30m": 30 * 60_000 };

/**
 * Fetch candles from Yahoo Finance's public chart endpoint (no API key).
 * 5m and 30m data go back at most ~60 days. The still-forming candle is dropped.
 */
export async function fetchCandles(ticker: string, interval: "5m" | "30m", range = "60d"): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 forex-signal-bot" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${ticker} ${interval}`);
      const json = (await res.json()) as any;
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error(`No data for ${ticker}: ${JSON.stringify(json?.chart?.error)}`);
      const ts: number[] = result.timestamp ?? [];
      const q = result.indicators?.quote?.[0] ?? {};
      const now = Date.now();
      const step = INTERVAL_MS[interval];
      const candles: Candle[] = [];
      for (let i = 0; i < ts.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if ([o, h, l, c].some((v) => v == null || Number.isNaN(v))) continue;
        const time = ts[i] * 1000;
        if (time + step > now) continue; // candle not closed yet
        candles.push({ time, open: o, high: h, low: l, close: c });
      }
      return candles;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw lastErr;
}
