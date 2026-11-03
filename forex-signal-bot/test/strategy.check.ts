import assert from "node:assert/strict";
import { test } from "node:test";
import { STRATEGY, SYMBOLS } from "../src/config.ts";
import { runBacktest } from "../src/backtest.ts";
import { startDashboard } from "../src/dashboard.ts";
import { demoData, demoState } from "../src/demo.ts";
import { adx, atr, ema, rsi } from "../src/indicators.ts";
import { blockingNews } from "../src/news.ts";
import { newState, todayR, tryOpen, updateOpenTrades } from "../src/paper.ts";
import { lotSize, pipValueUSD, portfolioBlock } from "../src/risk.ts";
import { sessionAt } from "../src/sessions.ts";
import { simulate } from "../src/simulate.ts";
import { findSignals } from "../src/strategy.ts";
import { synthetic5m, to30m } from "../src/synthetic.ts";
import type { Candle, Signal } from "../src/types.ts";

const sig = (over: Partial<Signal> = {}): Signal => ({
  id: "x", symbol: "EURUSD", setup: "TREND_PULLBACK", side: "BUY", candleTime: 0,
  entry: 1, stopLoss: 0.99, tp1: 1.01, tp2: 1.02, atr: 0, score: 80, factors: [], ...over,
});
const bar = (time: number, high: number, low: number, close = (high + low) / 2): Candle => ({ time, open: close, high, low, close });

test("indicators", () => {
  assert.deepEqual(ema([2, 2, 2, 2, 2], 3).slice(2), [2, 2, 2]);
  assert.equal(rsi([1, 2, 3, 4, 5, 6], 3)[5], 100);
  assert.equal(rsi([6, 5, 4, 3, 2, 1], 3)[5], 0);
  assert.equal(atr([2, 2, 2, 2], [1, 1, 1, 1], [1.5, 1.5, 1.5, 1.5], 2)[3], 1);
  // A steady uptrend has a high ADX.
  const up = Array.from({ length: 60 }, (_, i) => i);
  const a = adx(up.map((v) => v + 1), up.map((v) => v - 0.5), up, 14);
  assert.ok(a[59] > 90, `ADX ${a[59]}`);
});

test("sessions (UTC)", () => {
  assert.equal(sessionAt(Date.UTC(2026, 0, 5, 3)), "ASIA");
  assert.equal(sessionAt(Date.UTC(2026, 0, 5, 9)), "LONDON");
  assert.equal(sessionAt(Date.UTC(2026, 0, 5, 13)), "OVERLAP");
  assert.equal(sessionAt(Date.UTC(2026, 0, 5, 18)), "NEW_YORK");
});

test("signals never use future candles (no repainting)", () => {
  const c5 = synthetic5m(9000);
  const p = { ...STRATEGY, minScore: 0 };
  const full = findSignals("EURUSD", c5, to30m(c5), p);
  assert.ok(full.size > 20, `expected signals, got ${full.size}`);
  for (const cut of [3000, 5000, 7777]) {
    const part = c5.slice(0, cut);
    const partial = findSignals("EURUSD", part, to30m(part), p);
    for (const [i, s] of partial) assert.deepEqual(full.get(i), s);
    for (const [i] of full) if (i < cut) assert.ok(partial.has(i), `signal at ${i} missing with less data`);
  }
});

test("signals respect score, session filter and the 30m trend", () => {
  const c5 = synthetic5m(9000, 7);
  for (const s of findSignals("EURUSD", c5, to30m(c5)).values()) {
    assert.ok(s.score >= STRATEGY.minScore && s.score <= 100);
    assert.notEqual(sessionAt(s.candleTime + 300_000), "ASIA");
    assert.ok(s.factors[0].label.includes(s.side === "BUY" ? "UP" : "DOWN"));
    const dir = s.side === "BUY" ? 1 : -1;
    assert.ok(dir * (s.tp2 - s.tp1) > 0 && dir * (s.tp1 - s.entry) > 0 && dir * (s.entry - s.stopLoss) > 0);
  }
});

test("trade management: SL, TP1 + breakeven, TP2, ambiguity", () => {
  const s = sig();
  // Straight to stop.
  assert.equal(simulate(s, [bar(0, 1, 1), bar(1, 1.001, 0.985)], 0, 0).r, -1);
  // Candle touching stop and TP1 counts as the stop.
  assert.equal(simulate(s, [bar(0, 1, 1), bar(1, 1.015, 0.985)], 0, 0).outcome, "LOSS");
  // TP1, then back to entry: half at +1R, half at 0.
  const be = simulate(s, [bar(0, 1, 1), bar(1, 1.011, 1.001), bar(2, 1.005, 0.999)], 0, 0);
  assert.equal(be.outcome, "BREAKEVEN");
  assert.equal(be.r, 0.5);
  // TP1 then TP2: 0.5*1 + 0.5*2 = 1.5R, minus spread of 0.1R.
  const win = simulate(s, [bar(0, 1, 1), bar(1, 1.011, 1.001), bar(2, 1.021, 1.005)], 0, 0.001);
  assert.equal(win.outcome, "WIN");
  assert.ok(Math.abs(win.r - 1.4) < 1e-9, String(win.r));
  // Sell side mirror.
  const sell = sig({ side: "SELL", stopLoss: 1.01, tp1: 0.99, tp2: 0.98 });
  assert.equal(simulate(sell, [bar(0, 1, 1), bar(1, 0.999, 0.97)], 0, 0).outcome, "WIN");
});

test("lot size and pip value", () => {
  const eur = SYMBOLS.find((s) => s.name === "EURUSD")!;
  assert.equal(pipValueUSD(eur, 1.1), 10);
  const jpy = SYMBOLS.find((s) => s.name === "USDJPY")!;
  assert.ok(Math.abs(pipValueUSD(jpy, 150) - 1000 / 150) < 1e-9);
  const ej = SYMBOLS.find((s) => s.name === "EURJPY")!;
  assert.ok(Math.abs(pipValueUSD(ej, 162, { USDJPY: 150 }) - 1000 / 150) < 1e-9);
  // $10,000 at 1% = $100 risk, 20 pip stop on EURUSD = 0.5 lot.
  const l = lotSize(sig({ entry: 1.1, stopLoss: 1.098 }), 10_000, {}, 1);
  assert.equal(l.lots, 0.5);
  assert.equal(Math.round(l.slPips), 20);
});

test("portfolio rules", () => {
  const s = sig({ symbol: "GBPUSD" });
  assert.match(portfolioBlock(s, [{ symbol: "GBPUSD" }], 0)!, /already/);
  assert.match(portfolioBlock(s, [{ symbol: "EURUSD" }, { symbol: "AUDUSD" }], 0)!, /USD/);
  assert.match(portfolioBlock(s, [], -3)!, /daily loss/);
  assert.equal(portfolioBlock(sig({ symbol: "EURJPY" }), [{ symbol: "AUDUSD" }], 0), null);
});

test("news filter blocks only the affected currencies inside the window", () => {
  const t = Date.UTC(2026, 0, 9, 13, 30);
  const events = [{ title: "Non-Farm Payrolls", currency: "USD", time: t, impact: "High" }];
  assert.ok(blockingNews(events, ["EUR", "USD"], t - 20 * 60_000));
  assert.equal(blockingNews(events, ["EUR", "JPY"], t), undefined);
  assert.equal(blockingNews(events, ["EUR", "USD"], t - 45 * 60_000), undefined);
});

test("paper account opens, tracks and closes trades", () => {
  const st = newState();
  const c5 = [bar(0, 1, 1, 1), bar(300_000, 1.011, 1.001), bar(600_000, 1.021, 1.005)];
  const s = sig({ id: "a", candleTime: 0 });
  assert.equal(tryOpen(st, s, {}).status, "OPENED");
  assert.equal(st.open.length, 1);
  assert.equal(tryOpen(st, sig({ id: "b" }), {}).reason, "already in a EURUSD trade");
  const closed = updateOpenTrades(st, [{ cfg: SYMBOLS[0], c5, c30: [] }]);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].result.outcome, "WIN");
  assert.ok(st.balance > st.startingBalance);
  assert.ok(todayR(st, 600_000) > 1);
  st.paused = true;
  assert.equal(tryOpen(st, sig({ id: "c" }), {}).reason, "bot paused");
});

test("portfolio backtest and dashboard API work end to end", async () => {
  const data = demoData();
  const bt = runBacktest(data);
  assert.ok(bt.stats.trades > 20, `trades ${bt.stats.trades}`);
  const maxOpen = Math.max(...bt.trades.map((t) => bt.trades.filter((o) => o.candleTime <= t.candleTime && (o.exitTime ?? Infinity) > t.candleTime).length));
  assert.ok(maxOpen <= 3, `max concurrent ${maxOpen}`);
  console.log(`synthetic portfolio: ${bt.stats.trades} trades, win ${(bt.stats.winRate * 100).toFixed(1)}%, avg ${bt.stats.avgR.toFixed(3)}R, PF ${bt.stats.profitFactor.toFixed(2)}`);

  const { state, backtest } = demoState(data);
  let paused = false;
  const server = await startDashboard(
    { state: () => state, backtest: () => backtest, news: () => [], setPaused: (p) => (paused = p), telegram: false },
    0,
  );
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try {
    assert.match(await (await fetch(base + "/")).text(), /Forex Signal Bot/);
    const api = await (await fetch(base + "/api/state")).json();
    assert.equal(api.state.demo, true);
    assert.ok(api.backtest.overall.trades > 0);
    await fetch(base + "/api/pause", { method: "POST" });
    assert.equal(paused, true);
  } finally {
    server.close();
  }
});
