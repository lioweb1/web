import { STRATEGY } from "./config.ts";
import type { Candle, Signal, TradeResult } from "./types.ts";

/**
 * Walk forward from the signal candle and see whether SL or TP is hit first.
 * Conservative: if one candle touches both, it counts as a loss. Spread is paid on entry
 * (buys fill at ask = mid + spread, sells exit at ask), so R values are after costs.
 */
export function simulate(signal: Signal, c5: Candle[], signalIndex: number, spread: number): TradeResult {
  const dir = signal.side === "BUY" ? 1 : -1;
  const risk = Math.abs(signal.entry - signal.stopLoss);
  const toR = (exit: number) => (dir * (exit - signal.entry) - spread) / risk;
  const last = Math.min(c5.length - 1, signalIndex + STRATEGY.maxHoldCandles);

  for (let k = signalIndex + 1; k <= last; k++) {
    const c = c5[k];
    const hitSl = dir === 1 ? c.low <= signal.stopLoss : c.high >= signal.stopLoss;
    const hitTp = dir === 1 ? c.high >= signal.takeProfit : c.low <= signal.takeProfit;
    if (hitSl) return { outcome: "LOSS", r: toR(signal.stopLoss), exitTime: c.time, exitPrice: signal.stopLoss };
    if (hitTp) return { outcome: "WIN", r: toR(signal.takeProfit), exitTime: c.time, exitPrice: signal.takeProfit };
  }
  if (signalIndex + STRATEGY.maxHoldCandles > c5.length - 1) return { outcome: "OPEN", r: 0 };
  const c = c5[last];
  return { outcome: "TIMEOUT", r: toR(c.close), exitTime: c.time, exitPrice: c.close };
}
