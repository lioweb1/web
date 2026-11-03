import type { TradeResult } from "./types.ts";

export interface Stats {
  trades: number;
  wins: number;
  partials: number;
  breakevens: number;
  losses: number;
  timeouts: number;
  /** Trades that ended with R > 0. */
  winRate: number;
  totalR: number;
  avgR: number;
  profitFactor: number;
  maxDrawdownR: number;
  maxLosingStreak: number;
}

export function computeStats(results: TradeResult[]): Stats {
  const closed = results.filter((r) => r.outcome !== "OPEN");
  let equity = 0, peak = 0, maxDd = 0, gross = 0, grossLoss = 0, streak = 0, maxStreak = 0;
  for (const r of closed) {
    equity += r.r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    if (r.r > 0) gross += r.r;
    else grossLoss -= r.r;
    streak = r.r < 0 ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
  }
  const count = (o: TradeResult["outcome"]) => closed.filter((r) => r.outcome === o).length;
  return {
    trades: closed.length,
    wins: count("WIN"),
    partials: count("PARTIAL"),
    breakevens: count("BREAKEVEN"),
    losses: count("LOSS"),
    timeouts: count("TIMEOUT"),
    winRate: closed.length ? closed.filter((r) => r.r > 0).length / closed.length : 0,
    totalR: equity,
    avgR: closed.length ? equity / closed.length : 0,
    profitFactor: grossLoss ? gross / grossLoss : gross ? 99 : 0,
    maxDrawdownR: maxDd,
    maxLosingStreak: maxStreak,
  };
}

export function formatStats(label: string, s: Stats): string {
  return (
    `${label.padEnd(16)} ${String(s.trades).padStart(4)} trades | win ${(s.winRate * 100).toFixed(1).padStart(5)}% | ` +
    `total ${s.totalR.toFixed(1).padStart(6)}R | avg ${s.avgR.toFixed(3).padStart(6)}R | PF ${s.profitFactor.toFixed(2).padStart(5)} | ` +
    `maxDD ${s.maxDrawdownR.toFixed(1)}R | worst streak ${s.maxLosingStreak}`
  );
}
