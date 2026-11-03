import { STRATEGY, type StrategyParams } from "./config.ts";
import type { Candle, Signal, TradeResult } from "./types.ts";

/**
 * Trade management: at TP1 close `tp1Fraction` and move the stop to breakeven; the rest runs
 * to TP2. Walks forward from the signal candle. Conservative on ambiguity: a candle touching
 * both the stop and a target counts as the stop first. Spread is charged once per trade.
 */
export function simulate(
  s: Signal,
  c5: Candle[],
  signalIndex: number,
  spread: number,
  p: StrategyParams = STRATEGY,
): TradeResult {
  const dir = s.side === "BUY" ? 1 : -1;
  const risk = Math.abs(s.entry - s.stopLoss);
  const cost = spread / risk;
  const f = p.tp1Fraction;
  const rAt = (price: number) => (dir * (price - s.entry)) / risk;
  const last = Math.min(c5.length - 1, signalIndex + p.maxHoldCandles);

  let tp1Hit = false;
  let stop = s.stopLoss;
  for (let k = signalIndex + 1; k <= last; k++) {
    const c = c5[k];
    const fav = dir > 0 ? c.high : c.low;
    const adv = dir > 0 ? c.low : c.high;
    const hitStop = dir * (adv - stop) <= 0;
    if (hitStop) {
      if (!tp1Hit) return { outcome: "LOSS", r: -1 - cost, tp1Hit, exitTime: c.time, exitPrice: stop };
      return { outcome: "BREAKEVEN", r: f * p.tp1R - cost, tp1Hit, exitTime: c.time, exitPrice: stop };
    }
    if (!tp1Hit && dir * (fav - s.tp1) >= 0) {
      tp1Hit = true;
      stop = s.entry;
    }
    if (tp1Hit && dir * (fav - s.tp2) >= 0) {
      return { outcome: "WIN", r: f * p.tp1R + (1 - f) * p.tp2R - cost, tp1Hit, exitTime: c.time, exitPrice: s.tp2 };
    }
  }
  if (signalIndex + p.maxHoldCandles > c5.length - 1) {
    const now = c5[c5.length - 1].close;
    const floating = tp1Hit ? f * p.tp1R + (1 - f) * rAt(now) : rAt(now);
    return { outcome: "OPEN", r: floating - cost, tp1Hit };
  }
  const c = c5[last];
  const r = tp1Hit ? f * p.tp1R + (1 - f) * rAt(c.close) : rAt(c.close);
  return { outcome: tp1Hit ? "PARTIAL" : "TIMEOUT", r: r - cost, tp1Hit, exitTime: c.time, exitPrice: c.close };
}
