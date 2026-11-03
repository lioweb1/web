import { STRATEGY, SYMBOLS, type StrategyParams } from "./config.ts";
import { loadAll, type SymbolData } from "./data.ts";
import { runBacktest, splitTime } from "./backtest.ts";
import { formatStats, type Stats } from "./stats.ts";

const GRID = {
  minScore: [50, 60, 70, 80],
  slAtr: [1, 1.5, 2],
  tp2R: [1.5, 2, 3],
  enabledSetups: [["TREND_PULLBACK", "BREAKOUT"], ["TREND_PULLBACK"], ["BREAKOUT"]] as StrategyParams["enabledSetups"][],
};

/**
 * Grid search on the first 70% of the data, then re-test the best settings on the unseen
 * last 30%. Settings that only look good in-sample are overfit - prefer ones that hold up.
 */
export function optimize(data: SymbolData[], minTrades = 30) {
  const split = splitTime(data);
  const rows: Array<{ p: StrategyParams; ins: Stats; oos: Stats }> = [];
  for (const minScore of GRID.minScore)
    for (const slAtr of GRID.slAtr)
      for (const tp2R of GRID.tp2R)
        for (const enabledSetups of GRID.enabledSetups) {
          const p = { ...STRATEGY, minScore, slAtr, tp2R, enabledSetups };
          const ins = runBacktest(data, p, { to: split }).stats;
          if (ins.trades < minTrades) continue;
          rows.push({ p, ins, oos: runBacktest(data, p, { from: split }).stats });
        }
  return rows.sort((a, b) => b.ins.avgR - a.ins.avgR);
}

async function main() {
  console.log("Downloading data...");
  const data = await loadAll(SYMBOLS);
  const rows = optimize(data);
  console.log(`\nTested ${rows.length} combinations. Top 10 by in-sample avg R, with their out-of-sample result:\n`);
  for (const { p, ins, oos } of rows.slice(0, 10)) {
    console.log(`minScore=${p.minScore} slAtr=${p.slAtr} tp2R=${p.tp2R} setups=${p.enabledSetups.join("+")}`);
    console.log("  " + formatStats("in-sample", ins));
    console.log("  " + formatStats("out-of-sample", oos));
  }
  console.log("\nPick settings whose OUT-OF-SAMPLE result is still positive, then put them in src/config.ts.");
}

if (import.meta.main) await main();
