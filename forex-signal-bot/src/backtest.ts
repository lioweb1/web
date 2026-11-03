import { SYMBOLS, type SymbolConfig } from "./config.ts";
import { fetchCandles } from "./data.ts";
import { simulate } from "./simulate.ts";
import { computeStats, formatStats } from "./stats.ts";
import { findSignals } from "./strategy.ts";
import type { Candle, TradeResult } from "./types.ts";

/** Backtest one symbol, one trade at a time (signals while a trade is open are skipped). */
export function backtest(cfg: SymbolConfig, c5: Candle[], c30: Candle[]): TradeResult[] {
  const signals = findSignals(cfg.name, c5, c30);
  const results: TradeResult[] = [];
  let busyUntil = -Infinity;
  for (const [i, sig] of [...signals.entries()].sort((a, b) => a[0] - b[0])) {
    if (sig.candleTime <= busyUntil) continue;
    const res = simulate(sig, c5, i, cfg.spread);
    results.push(res);
    busyUntil = res.exitTime ?? Infinity;
  }
  return results;
}

async function main() {
  console.log("Backtesting last ~60 days of 5m candles (30m trend filter), spread included...\n");
  const all: TradeResult[] = [];
  for (const cfg of SYMBOLS) {
    try {
      const [c5, c30] = await Promise.all([fetchCandles(cfg.yahoo, "5m"), fetchCandles(cfg.yahoo, "30m")]);
      const res = backtest(cfg, c5, c30);
      all.push(...res);
      console.log(formatStats(cfg.name, computeStats(res)));
    } catch (err) {
      console.error(`${cfg.name}: ${(err as Error).message}`);
    }
  }
  console.log("-".repeat(110));
  console.log(formatStats("ALL", computeStats(all)));
  console.log(
    "\nHow to read this: with a 1.5R target you need a win rate above ~40% just to break even." +
      "\nLook at avg R and profit factor (PF > 1 means profitable after spread), not only win %." +
      "\n60 days is a small sample - treat any result as a rough hint, not proof."
  );
}

if (import.meta.main) await main();
