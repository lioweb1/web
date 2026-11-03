import type { Candle } from "./types.ts";

/**
 * Deterministic random-walk candles with slowly changing drift. Used by tests and the demo
 * dashboard. There is no real edge in this data; it only exercises the code paths.
 */
export function synthetic5m(
  n: number,
  seed = 42,
  start = 1.1,
  vol = 0.0006,
  t0 = Date.UTC(2026, 0, 5),
  trend = 0.07,
): Candle[] {
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
  const out: Candle[] = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 400 + seed) * vol * trend;
    const open = px;
    const close = open + drift + (rand() - 0.5) * vol;
    const high = Math.max(open, close) + rand() * vol * 0.33;
    const low = Math.min(open, close) - rand() * vol * 0.33;
    out.push({ time: t0 + i * 300_000, open, high, low, close });
    px = close;
  }
  return out;
}

/** Aggregate 5m candles into 30m candles aligned to the half hour. */
export function to30m(c5: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const c of c5) {
    const slot = c.time - (c.time % 1_800_000);
    const last = out[out.length - 1];
    if (last && last.time === slot) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
    } else {
      out.push({ time: slot, open: c.open, high: c.high, low: c.low, close: c.close });
    }
  }
  return out;
}
