import { existsSync, readFileSync } from "node:fs";
import { SYMBOLS } from "./config.ts";
import { fetchCandles } from "./data.ts";
import { simulate } from "./simulate.ts";
import { computeStats, formatStats } from "./stats.ts";
import type { Signal, TradeResult } from "./types.ts";

/** Grades every live signal in signals.jsonl against what price actually did afterwards. */
const LOG = new URL("../signals.jsonl", import.meta.url);
if (!existsSync(LOG)) {
  console.log("No signals.jsonl yet - run `npm run live` first.");
  process.exit(0);
}
const signals = readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Signal);
const all: TradeResult[] = [];
for (const cfg of SYMBOLS) {
  const mine = signals.filter((s) => s.symbol === cfg.name);
  if (!mine.length) continue;
  const c5 = await fetchCandles(cfg.yahoo, "5m");
  const res: TradeResult[] = [];
  for (const s of mine) {
    const i = c5.findIndex((c) => c.time === s.candleTime);
    if (i < 0) continue; // older than the data window
    const r = simulate(s, c5, i, cfg.spread);
    res.push(r);
    const when = new Date(s.candleTime).toISOString().slice(0, 16).replace("T", " ");
    console.log(`${when}  ${s.symbol} ${s.side.padEnd(4)} -> ${r.outcome.padEnd(7)} ${r.r.toFixed(2)}R`);
  }
  all.push(...res);
}
console.log("\n" + formatStats("LIVE", computeStats(all)));
