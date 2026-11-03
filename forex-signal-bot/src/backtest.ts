import { mkdirSync, writeFileSync } from "node:fs";
import { RISK, STRATEGY, SYMBOLS, type StrategyParams } from "./config.ts";
import { loadAll, type SymbolData } from "./data.ts";
import { portfolioBlock } from "./risk.ts";
import { simulate } from "./simulate.ts";
import { computeStats, formatStats, type Stats } from "./stats.ts";
import { findSignals } from "./strategy.ts";
import type { Signal, TradeResult } from "./types.ts";

export type BacktestTrade = Signal & TradeResult;

export interface BacktestResult {
  trades: BacktestTrade[];
  stats: Stats;
  equity: Array<{ time: number; balance: number }>;
  finalBalance: number;
}

const utcDay = (ms: number) => Math.floor(ms / 86_400_000);

/**
 * Portfolio backtest across all symbols, in time order, applying the same portfolio rules as
 * live trading (max open trades, per-currency exposure, daily loss limit).
 */
export function runBacktest(
  data: SymbolData[],
  p: StrategyParams = STRATEGY,
  range: { from?: number; to?: number } = {},
): BacktestResult {
  const events: Array<{ sig: Signal; index: number; d: SymbolData }> = [];
  for (const d of data) {
    for (const [index, sig] of findSignals(d.cfg.name, d.c5, d.c30, p)) {
      if (range.from != null && sig.candleTime < range.from) continue;
      if (range.to != null && sig.candleTime >= range.to) continue;
      events.push({ sig, index, d });
    }
  }
  events.sort((a, b) => a.sig.candleTime - b.sig.candleTime);

  const trades: BacktestTrade[] = [];
  let open: BacktestTrade[] = [];
  for (const { sig, index, d } of events) {
    const now = sig.candleTime;
    open = open.filter((t) => t.exitTime == null || t.exitTime > now);
    const dayR = trades
      .filter((t) => t.exitTime != null && t.exitTime <= now && utcDay(t.exitTime) === utcDay(now))
      .reduce((s, t) => s + t.r, 0);
    if (portfolioBlock(sig, open, dayR)) continue;
    const t: BacktestTrade = { ...sig, ...simulate(sig, d.c5, index, d.cfg.spread, p) };
    trades.push(t);
    open.push(t);
  }

  const closed = trades.filter((t) => t.outcome !== "OPEN").sort((a, b) => a.exitTime! - b.exitTime!);
  let balance = RISK.startingBalance;
  const equity = [{ time: closed[0]?.candleTime ?? Date.now(), balance }];
  for (const t of closed) {
    balance += (balance * RISK.riskPercent * t.r) / 100;
    equity.push({ time: t.exitTime!, balance });
  }
  return { trades, stats: computeStats(closed), equity, finalBalance: balance };
}

/** First 70% of the data period is in-sample, the last 30% out-of-sample. */
export function splitTime(data: SymbolData[], frac = 0.7): number {
  const times = data.flatMap((d) => [d.c5[0]?.time, d.c5[d.c5.length - 1]?.time]).filter((t) => t != null);
  const lo = Math.min(...times), hi = Math.max(...times);
  return lo + (hi - lo) * frac;
}

export function report(data: SymbolData[], p: StrategyParams = STRATEGY) {
  const all = runBacktest(data, p);
  const split = splitTime(data);
  const ins = runBacktest(data, p, { to: split });
  const oos = runBacktest(data, p, { from: split });
  const group = (key: (t: BacktestTrade) => string) => {
    const m = new Map<string, BacktestTrade[]>();
    for (const t of all.trades) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
    return [...m.entries()].sort().map(([k, ts]) => ({ key: k, stats: computeStats(ts) }));
  };
  return {
    generatedAt: Date.now(),
    params: p,
    risk: RISK,
    from: data.length ? Math.min(...data.map((d) => d.c5[0].time)) : null,
    to: data.length ? Math.max(...data.map((d) => d.c5[d.c5.length - 1].time)) : null,
    overall: all.stats,
    finalBalance: all.finalBalance,
    equity: all.equity,
    inSample: ins.stats,
    outOfSample: oos.stats,
    bySymbol: group((t) => t.symbol),
    bySetup: group((t) => t.setup),
    byScore: group((t) => (t.score >= 80 ? "80-100" : t.score >= 70 ? "70-79" : t.score >= 60 ? "60-69" : "<60")),
    trades: all.trades.slice(-300),
  };
}

export type Report = ReturnType<typeof report>;

export function printReport(r: Report) {
  const line = "-".repeat(118);
  console.log(`Period: ${new Date(r.from ?? 0).toISOString().slice(0, 10)} -> ${new Date(r.to ?? 0).toISOString().slice(0, 10)}`);
  console.log(line);
  for (const g of r.bySymbol) console.log(formatStats(g.key, g.stats));
  console.log(line);
  for (const g of r.bySetup) console.log(formatStats(g.key, g.stats));
  console.log(line);
  for (const g of r.byScore) console.log(formatStats(`score ${g.key}`, g.stats));
  console.log(line);
  console.log(formatStats("IN-SAMPLE 70%", r.inSample));
  console.log(formatStats("OUT-SAMPLE 30%", r.outOfSample));
  console.log(formatStats("ALL", r.overall));
  console.log(
    `\n$${RISK.startingBalance.toLocaleString()} at ${RISK.riskPercent}% risk per trade -> $${r.finalBalance.toFixed(0)}` +
      "\n\nHow to read this: avg R and PF (profit factor) matter more than win %. PF > 1 = profitable after spread." +
      "\nTrust OUT-SAMPLE more than IN-SAMPLE. ~60 days is a small sample - a hint, not proof.",
  );
}

export function saveReport(r: Report, file = new URL("../data/backtest.json", import.meta.url)) {
  mkdirSync(new URL(".", file), { recursive: true });
  writeFileSync(file, JSON.stringify(r));
}

async function main() {
  console.log("Downloading ~60 days of 5m and 30m candles...\n");
  const data = await loadAll(SYMBOLS);
  if (!data.length) throw new Error("No data downloaded - check your internet connection.");
  const r = report(data);
  printReport(r);
  saveReport(r);
  console.log("\nSaved to data/backtest.json (shown on the dashboard).");
}

if (import.meta.main) await main();
