import assert from "node:assert/strict";
import { test } from "node:test";
import { SYMBOLS } from "../src/config.ts";
import { backtest } from "../src/backtest.ts";
import { atr, ema, rsi } from "../src/indicators.ts";
import { simulate } from "../src/simulate.ts";
import { computeStats } from "../src/stats.ts";
import { findSignals } from "../src/strategy.ts";
import type { Candle, Signal } from "../src/types.ts";

/** Deterministic random walk with drifting regimes, 5m candles. */
function synthetic5m(n: number, seed = 42): Candle[] {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const out: Candle[] = [];
  let px = 1.1;
  const t0 = Date.UTC(2026, 0, 5);
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 400) * 0.00004;
    const open = px;
    const close = open + drift + (rand() - 0.5) * 0.0006;
    const high = Math.max(open, close) + rand() * 0.0002;
    const low = Math.min(open, close) - rand() * 0.0002;
    out.push({ time: t0 + i * 300_000, open, high, low, close });
    px = close;
  }
  return out;
}

function to30m(c5: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + 6 <= c5.length; i += 6) {
    const g = c5.slice(i, i + 6);
    out.push({
      time: g[0].time,
      open: g[0].open,
      close: g[5].close,
      high: Math.max(...g.map((c) => c.high)),
      low: Math.min(...g.map((c) => c.low)),
    });
  }
  return out;
}

test("indicators", () => {
  assert.deepEqual(ema([2, 2, 2, 2, 2], 3).slice(2), [2, 2, 2]);
  assert.equal(rsi([1, 2, 3, 4, 5, 6], 3)[5], 100);
  assert.equal(rsi([6, 5, 4, 3, 2, 1], 3)[5], 0);
  const a = atr([2, 2, 2, 2], [1, 1, 1, 1], [1.5, 1.5, 1.5, 1.5], 2);
  assert.equal(a[3], 1);
});

test("signals never use future candles", () => {
  const c5 = synthetic5m(6000);
  const full = findSignals("EURUSD", c5, to30m(c5));
  assert.ok(full.size > 0, "expected at least one signal on synthetic data");
  for (const cut of [2000, 3500, 5000]) {
    const part5 = c5.slice(0, cut);
    const partial = findSignals("EURUSD", part5, to30m(part5));
    for (const [i, sig] of partial) assert.deepEqual(full.get(i), sig);
    for (const [i] of full) if (i < cut) assert.ok(partial.has(i), `signal at ${i} missing with less data`);
  }
});

test("simulate counts a candle touching both SL and TP as a loss", () => {
  const sig: Signal = {
    symbol: "EURUSD", side: "BUY", candleTime: 0, entry: 1, stopLoss: 0.99, takeProfit: 1.015,
    atr: 0, rsi: 55, reasons: [],
  };
  const c5: Candle[] = [
    { time: 0, open: 1, high: 1, low: 1, close: 1 },
    { time: 1, open: 1, high: 1.02, low: 0.98, close: 1 },
  ];
  const r = simulate(sig, c5, 0, 0);
  assert.equal(r.outcome, "LOSS");
  assert.equal(r.r, -1);
  c5[1].low = 1;
  const w = simulate(sig, c5, 0, 0.001);
  assert.equal(w.outcome, "WIN");
  assert.ok(Math.abs(w.r - 1.4) < 1e-9, "spread reduces the win");
});

test("backtest runs end to end", () => {
  const c5 = synthetic5m(12000);
  const stats = computeStats(backtest(SYMBOLS[0], c5, to30m(c5)));
  assert.ok(stats.trades > 0);
  console.log(`synthetic random walk: ${stats.trades} trades, win ${(stats.winRate * 100).toFixed(1)}%, avg ${stats.avgR.toFixed(3)}R`);
});
