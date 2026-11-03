import type { TradeResult } from "./types.ts";

export interface Stats {
  trades: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRate: number;
  totalR: number;
  avgR: number;
  profitFactor: number;
  maxDrawdownR: number;
}

export function computeStats(results: TradeResult[]): Stats {
  const closed = results.filter((r) => r.outcome !== "OPEN");
  let equity = 0, peak = 0, maxDd = 0, gross = 0, grossLoss = 0;
  for (const r of closed) {
    equity += r.r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    if (r.r > 0) gross += r.r;
    else grossLoss -= r.r;
  }
  const wins = closed.filter((r) => r.outcome === "WIN").length;
  return {
    trades: closed.length,
    wins,
    losses: closed.filter((r) => r.outcome === "LOSS").length,
    timeouts: closed.filter((r) => r.outcome === "TIMEOUT").length,
    winRate: closed.length ? wins / closed.length : 0,
    totalR: equity,
    avgR: closed.length ? equity / closed.length : 0,
    profitFactor: grossLoss ? gross / grossLoss : gross ? Infinity : 0,
    maxDrawdownR: maxDd,
  };
}

export function formatStats(label: string, s: Stats): string {
  return (
    `${label.padEnd(8)} trades ${String(s.trades).padStart(4)} | win ${(s.winRate * 100).toFixed(1).padStart(5)}% ` +
    `(W${s.wins}/L${s.losses}/T${s.timeouts}) | total ${s.totalR.toFixed(1).padStart(6)}R | ` +
    `avg ${s.avgR.toFixed(3).padStart(6)}R | PF ${s.profitFactor.toFixed(2)} | maxDD ${s.maxDrawdownR.toFixed(1)}R`
  );
}
