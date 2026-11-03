import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { RISK, STRATEGY } from "./config.ts";
import type { SymbolData } from "./data.ts";
import { lotSize, portfolioBlock, type PriceMap } from "./risk.ts";
import { simulate } from "./simulate.ts";
import type { Signal, TradeResult } from "./types.ts";

export interface PaperTrade extends Signal {
  lots: number;
  riskUSD: number;
  slPips: number;
  result: TradeResult;
  pnlUSD: number;
}

export interface SignalLog extends Signal {
  status: "OPENED" | "BLOCKED";
  reason?: string;
  lots?: number;
}

export interface PaperState {
  startingBalance: number;
  balance: number;
  paused: boolean;
  open: PaperTrade[];
  closed: PaperTrade[];
  signals: SignalLog[];
  equity: Array<{ time: number; balance: number }>;
  lastScan: number | null;
  demo?: boolean;
}

export function newState(): PaperState {
  return {
    startingBalance: RISK.startingBalance,
    balance: RISK.startingBalance,
    paused: false,
    open: [],
    closed: [],
    signals: [],
    equity: [{ time: Date.now(), balance: RISK.startingBalance }],
    lastScan: null,
  };
}

export function loadState(file: URL): PaperState {
  if (!existsSync(file)) return newState();
  return JSON.parse(readFileSync(file, "utf8")) as PaperState;
}

export function saveState(state: PaperState, file: URL) {
  mkdirSync(new URL(".", file), { recursive: true });
  state.signals = state.signals.slice(-300);
  writeFileSync(file, JSON.stringify(state, null, 1));
}

const utcDay = (ms: number) => Math.floor(ms / 86_400_000);

/** Sum of R of trades closed on the UTC day of `now`. */
export function todayR(state: PaperState, now = Date.now()): number {
  return state.closed
    .filter((t) => t.result.exitTime && utcDay(t.result.exitTime) === utcDay(now))
    .reduce((s, t) => s + t.result.r, 0);
}

/** Re-checks every open trade against fresh candles. Returns trades that closed this round. */
export function updateOpenTrades(state: PaperState, data: SymbolData[]): PaperTrade[] {
  const closedNow: PaperTrade[] = [];
  state.open = state.open.filter((t) => {
    const d = data.find((x) => x.cfg.name === t.symbol);
    const i = d ? d.c5.findIndex((c) => c.time === t.candleTime) : -1;
    if (!d || i < 0) return true;
    t.result = simulate(t, d.c5, i, d.cfg.spread);
    t.pnlUSD = t.riskUSD * t.result.r;
    if (t.result.outcome === "OPEN") return true;
    state.balance += t.pnlUSD;
    state.equity.push({ time: t.result.exitTime ?? Date.now(), balance: state.balance });
    state.closed.push(t);
    closedNow.push(t);
    return false;
  });
  return closedNow;
}

/** Applies pause, news and portfolio rules, and opens a paper trade if allowed. */
export function tryOpen(state: PaperState, sig: Signal, prices: PriceMap, blockedBy?: string): SignalLog {
  const reason =
    blockedBy ?? (state.paused ? "bot paused" : portfolioBlock(sig, state.open, todayR(state, sig.candleTime)));
  if (reason) {
    const log: SignalLog = { ...sig, status: "BLOCKED", reason };
    state.signals.push(log);
    return log;
  }
  const size = lotSize(sig, state.balance, prices);
  state.open.push({ ...sig, ...size, result: { outcome: "OPEN", r: 0, tp1Hit: false }, pnlUSD: 0 });
  const log: SignalLog = { ...sig, status: "OPENED", lots: size.lots };
  state.signals.push(log);
  return log;
}

export function strategySummary(): string {
  const p = STRATEGY;
  return `min score ${p.minScore}, SL ${p.slAtr}xATR, TP1 ${p.tp1R}R (${p.tp1Fraction * 100}%), TP2 ${p.tp2R}R, risk ${RISK.riskPercent}%/trade`;
}
