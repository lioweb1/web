import { FIVE_MIN, STRATEGY, THIRTY_MIN, type StrategyParams } from "./config.ts";
import { adx, atr, ema, rsi, sma } from "./indicators.ts";
import { sessionAt } from "./sessions.ts";
import type { Candle, ScoreFactor, Setup, Side, Signal } from "./types.ts";

export type Trend = "UP" | "DOWN" | "NONE";

/** 30m trend per candle: UP when close > slow EMA and fast EMA > slow EMA, DOWN for the mirror. */
export function trend30m(c30: Candle[], p: StrategyParams = STRATEGY): Trend[] {
  const close = c30.map((c) => c.close);
  const fast = ema(close, p.trendFast);
  const slow = ema(close, p.trendSlow);
  return c30.map((c, i) => {
    if (Number.isNaN(slow[i])) return "NONE";
    if (c.close > slow[i] && fast[i] > slow[i]) return "UP";
    if (c.close < slow[i] && fast[i] < slow[i]) return "DOWN";
    return "NONE";
  });
}

/**
 * Scan 5m candles and return every signal, keyed by 5m candle index.
 * Only data available at that candle's close is used (no look-ahead / repainting):
 * the 30m context comes from the last 30m candle that had fully closed by then.
 */
export function findSignals(symbol: string, c5: Candle[], c30: Candle[], p: StrategyParams = STRATEGY): Map<number, Signal> {
  const close = c5.map((c) => c.close);
  const high = c5.map((c) => c.high);
  const low = c5.map((c) => c.low);
  const fast = ema(close, p.entryFast);
  const slow = ema(close, p.entrySlow);
  const base = ema(close, p.entryBaseline);
  const r = rsi(close, p.rsiPeriod);
  const a = atr(high, low, close, p.atrPeriod);
  const aAvg = sma(a.map((v) => (Number.isNaN(v) ? 0 : v)), 100);
  const trends = trend30m(c30, p);
  const adx30 = adx(c30.map((c) => c.high), c30.map((c) => c.low), c30.map((c) => c.close), p.adxPeriod);

  const signals = new Map<number, Signal>();
  let j = -1; // last closed 30m candle
  const start = Math.max(p.breakoutLookback, 101);
  for (let i = 1; i < c5.length; i++) {
    const closeTime = c5[i].time + FIVE_MIN;
    while (j + 1 < c30.length && c30[j + 1].time + THIRTY_MIN <= closeTime) j++;
    if (i < start || j < 0) continue;
    if ([fast[i - 1], slow[i - 1], base[i], r[i], a[i], aAvg[i]].some(Number.isNaN)) continue;

    const trend = trends[j];
    if (trend === "NONE") continue;
    const side: Side = trend === "UP" ? "BUY" : "SELL";
    const dir = side === "BUY" ? 1 : -1;
    const session = sessionAt(closeTime);
    if (p.sessionFilter && session === "ASIA") continue;

    // --- Setup triggers (on the 5m chart, in the 30m trend direction) ---
    let setup: Setup | null = null;
    let trigger = "";
    const crossed = dir * (fast[i - 1] - slow[i - 1]) <= 0 && dir * (fast[i] - slow[i]) > 0;
    if (p.enabledSetups.includes("TREND_PULLBACK") && crossed && dir * (close[i] - base[i]) > 0) {
      setup = "TREND_PULLBACK";
      trigger = `5m EMA${p.entryFast} crossed ${dir > 0 ? "above" : "below"} EMA${p.entrySlow}`;
    } else if (p.enabledSetups.includes("BREAKOUT")) {
      let hi = -Infinity, lo = Infinity;
      for (let k = i - p.breakoutLookback; k < i; k++) {
        hi = Math.max(hi, high[k]);
        lo = Math.min(lo, low[k]);
      }
      const level = dir > 0 ? hi : lo;
      if (dir * (close[i] - level) > 0 && dir * (close[i - 1] - level) <= 0) {
        setup = "BREAKOUT";
        const hours = (p.breakoutLookback * 5) / 60;
        trigger = `5m close broke the ${hours}h ${dir > 0 ? "high" : "low"} (${level})`;
      }
    }
    if (!setup) continue;

    // --- Strength score (0-100) ---
    const factors: ScoreFactor[] = [];
    factors.push({ label: `30m trend ${trend} (EMA${p.trendFast}/${p.trendSlow})`, points: 25, max: 25 });
    factors.push({ label: trigger, points: 20, max: 20 });

    const adxV = adx30[j];
    const adxPts = Number.isNaN(adxV) ? 0 : adxV >= p.adxMin + 10 ? 15 : adxV >= p.adxMin ? 10 : 0;
    factors.push({ label: `30m ADX ${Number.isNaN(adxV) ? "n/a" : adxV.toFixed(1)} (trend strength)`, points: adxPts, max: 15 });

    const rsiV = r[i];
    const inZone = dir > 0 ? rsiV >= 50 && rsiV <= 70 : rsiV >= 30 && rsiV <= 50;
    const nearZone = dir > 0 ? rsiV >= 45 && rsiV <= 75 : rsiV >= 25 && rsiV <= 55;
    factors.push({ label: `RSI ${rsiV.toFixed(1)}`, points: inZone ? 10 : nearZone ? 5 : 0, max: 10 });

    const sessPts = session === "OVERLAP" ? 10 : session === "ASIA" ? 0 : 6;
    factors.push({ label: `Session: ${session.replace("_", " ")}`, points: sessPts, max: 10 });

    const last30 = c30[j];
    const mom = dir * (last30.close - last30.open) > 0;
    factors.push({ label: `Last 30m candle ${mom ? "with" : "against"} trend`, points: mom ? 10 : 0, max: 10 });

    const volRatio = a[i] / aAvg[i];
    const volPts = volRatio >= 0.8 && volRatio <= 2 ? 10 : volRatio > 2 ? 3 : 0;
    factors.push({ label: `Volatility ${volRatio.toFixed(2)}x normal`, points: volPts, max: 10 });

    const score = factors.reduce((s, f) => s + f.points, 0);
    if (score < p.minScore) continue;

    const risk = p.slAtr * a[i];
    const px = close[i];
    signals.set(i, {
      id: `${symbol}-${c5[i].time}`,
      symbol,
      setup,
      side,
      candleTime: c5[i].time,
      entry: px,
      stopLoss: px - dir * risk,
      tp1: px + dir * p.tp1R * risk,
      tp2: px + dir * p.tp2R * risk,
      atr: a[i],
      score,
      factors,
    });
  }
  return signals;
}
