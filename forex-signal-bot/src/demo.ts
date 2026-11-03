import { DASHBOARD_PORT, RISK, SYMBOLS } from "./config.ts";
import type { SymbolData } from "./data.ts";
import { report, runBacktest } from "./backtest.ts";
import { startDashboard } from "./dashboard.ts";
import { newState, type PaperState } from "./paper.ts";
import { lotSize } from "./risk.ts";
import { synthetic5m, to30m } from "./synthetic.ts";

/** Builds the dashboard from synthetic data so the layout can be checked without internet. */
export function demoData(): SymbolData[] {
  const starts: Record<string, number> = {
    EURUSD: 1.08, GBPUSD: 1.27, USDJPY: 150, AUDUSD: 0.66, USDCAD: 1.36, USDCHF: 0.88, EURJPY: 162, XAUUSD: 2400,
  };
  const n = 12 * 24 * 30; // 30 days of 5m candles
  const t0 = Math.floor(Date.now() / 300_000) * 300_000 - n * 300_000;
  return SYMBOLS.map((cfg, k) => {
    const start = starts[cfg.name] ?? 1;
    const c5 = synthetic5m(n, 1000 + k * 77, start, start * 0.0006, t0, 0.03);
    return { cfg, c5, c30: to30m(c5) };
  });
}

export function demoState(data: SymbolData[]): { state: PaperState; backtest: ReturnType<typeof report> } {
  const bt = report(data);
  const state = newState();
  state.demo = true;
  state.equity = [{ time: data[0].c5[0].time, balance: RISK.startingBalance }];
  const prices = Object.fromEntries(data.map((d) => [d.cfg.name, d.c5[d.c5.length - 1].close]));
  for (const t of [...runBacktest(data).trades].sort((a, b) => a.candleTime - b.candleTime)) {
    const size = lotSize(t, state.balance, prices);
    const { outcome, r, tp1Hit, exitTime, exitPrice, ...sig } = t;
    const trade = { ...sig, ...size, result: { outcome, r, tp1Hit, exitTime, exitPrice }, pnlUSD: size.riskUSD * r };
    state.signals.push({ ...sig, status: "OPENED", lots: size.lots });
    if (outcome === "OPEN") {
      state.open.push(trade);
      continue;
    }
    state.closed.push(trade);
  }
  for (const t of [...state.closed].sort((a, b) => a.result.exitTime! - b.result.exitTime!)) {
    state.balance += t.pnlUSD;
    state.equity.push({ time: t.result.exitTime!, balance: state.balance });
  }
  state.lastScan = Date.now();
  return { state, backtest: bt };
}

if (import.meta.main) {
  const { state, backtest } = demoState(demoData());
  const server = await startDashboard(
    { state: () => state, backtest: () => backtest, news: () => [], setPaused: (p) => (state.paused = p), telegram: false },
    DASHBOARD_PORT,
  );
  const addr = server.address();
  console.log(`Demo dashboard (synthetic data): http://localhost:${typeof addr === "object" && addr ? addr.port : DASHBOARD_PORT}`);
}
