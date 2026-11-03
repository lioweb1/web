import { FIVE_MIN, STRATEGY, THIRTY_MIN } from "./config.ts";
import { atr, ema, rsi } from "./indicators.ts";
import type { Candle, Signal } from "./types.ts";

export type Trend = "UP" | "DOWN" | "NONE";

/**
 * 30m trend for each 30m candle: UP when close > slow EMA and fast EMA > slow EMA,
 * DOWN for the mirror, otherwise NONE.
 */
export function trend30m(c30: Candle[]): Trend[] {
  const close = c30.map((c) => c.close);
  const fast = ema(close, STRATEGY.trendFast);
  const slow = ema(close, STRATEGY.trendSlow);
  return c30.map((c, i) => {
    if (Number.isNaN(slow[i])) return "NONE";
    if (c.close > slow[i] && fast[i] > slow[i]) return "UP";
    if (c.close < slow[i] && fast[i] < slow[i]) return "DOWN";
    return "NONE";
  });
}

/**
 * Scan 5m candles and return a signal for every candle index that triggers one.
 * Only data available at that candle's close is used (no look-ahead): the 30m trend
 * comes from the last 30m candle that had fully closed by then.
 */
export function findSignals(symbol: string, c5: Candle[], c30: Candle[]): Map<number, Signal> {
  const S = STRATEGY;
  const close = c5.map((c) => c.close);
  const fast = ema(close, S.entryFast);
  const slow = ema(close, S.entrySlow);
  const base = ema(close, S.entryBaseline);
  const r = rsi(close, S.rsiPeriod);
  const a = atr(c5.map((c) => c.high), c5.map((c) => c.low), close, S.atrPeriod);
  const trends = trend30m(c30);

  const signals = new Map<number, Signal>();
  let j = -1; // index of the last closed 30m candle
  for (let i = 1; i < c5.length; i++) {
    const closeTime = c5[i].time + FIVE_MIN;
    while (j + 1 < c30.length && c30[j + 1].time + THIRTY_MIN <= closeTime) j++;
    if (j < 0) continue;
    if ([fast[i - 1], slow[i - 1], base[i], r[i], a[i]].some(Number.isNaN)) continue;

    const t = trends[j];
    const crossUp = fast[i - 1] <= slow[i - 1] && fast[i] > slow[i];
    const crossDown = fast[i - 1] >= slow[i - 1] && fast[i] < slow[i];
    const px = close[i];

    let side: Signal["side"] | null = null;
    let reasons: string[] = [];
    if (t === "UP" && crossUp && px > base[i] && r[i] >= S.rsiBuyMin && r[i] <= S.rsiBuyMax) {
      side = "BUY";
      reasons = [
        `30m trend UP (EMA${S.trendFast} > EMA${S.trendSlow}, price above)`,
        `5m EMA${S.entryFast} crossed above EMA${S.entrySlow}`,
        `5m price above EMA${S.entryBaseline}`,
        `RSI ${r[i].toFixed(1)} in ${S.rsiBuyMin}-${S.rsiBuyMax}`,
      ];
    } else if (t === "DOWN" && crossDown && px < base[i] && r[i] >= S.rsiSellMin && r[i] <= S.rsiSellMax) {
      side = "SELL";
      reasons = [
        `30m trend DOWN (EMA${S.trendFast} < EMA${S.trendSlow}, price below)`,
        `5m EMA${S.entryFast} crossed below EMA${S.entrySlow}`,
        `5m price below EMA${S.entryBaseline}`,
        `RSI ${r[i].toFixed(1)} in ${S.rsiSellMin}-${S.rsiSellMax}`,
      ];
    }
    if (!side) continue;

    const dir = side === "BUY" ? 1 : -1;
    signals.set(i, {
      symbol,
      side,
      candleTime: c5[i].time,
      entry: px,
      stopLoss: px - dir * S.slAtr * a[i],
      takeProfit: px + dir * S.tpAtr * a[i],
      atr: a[i],
      rsi: r[i],
      reasons,
    });
  }
  return signals;
}
