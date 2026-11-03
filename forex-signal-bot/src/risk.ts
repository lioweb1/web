import { RISK, symbolConfig, type SymbolConfig } from "./config.ts";
import type { Signal } from "./types.ts";

/** Latest price per symbol name, used to convert cross-pair pip values to USD. */
export type PriceMap = Record<string, number>;

/** How many USD one unit of `currency` is worth. */
function toUSD(currency: string, prices: PriceMap): number | null {
  if (currency === "USD") return 1;
  if (prices[`${currency}USD`]) return prices[`${currency}USD`];
  if (prices[`USD${currency}`]) return 1 / prices[`USD${currency}`];
  return null;
}

/** USD value of one pip for 1.00 lot. */
export function pipValueUSD(cfg: SymbolConfig, price: number, prices: PriceMap = {}): number {
  const perLotInQuote = cfg.contractSize * cfg.pipSize;
  const rate = toUSD(cfg.quote, prices) ?? (cfg.base === "USD" ? 1 / price : null);
  if (rate == null) throw new Error(`No USD rate for ${cfg.quote}; add a ${cfg.quote}USD or USD${cfg.quote} symbol.`);
  return perLotInQuote * rate;
}

/** Lot size that risks `riskPercent` of `balance` if the stop is hit. Rounded down to 0.01. */
export function lotSize(
  signal: Signal,
  balance: number,
  prices: PriceMap = {},
  riskPercent = RISK.riskPercent,
): { lots: number; riskUSD: number; slPips: number } {
  const cfg = symbolConfig(signal.symbol);
  const slPips = Math.abs(signal.entry - signal.stopLoss) / cfg.pipSize;
  const riskUSD = (balance * riskPercent) / 100;
  const raw = riskUSD / (slPips * pipValueUSD(cfg, signal.entry, { ...prices, [cfg.name]: signal.entry }));
  const lots = Math.max(0.01, Math.floor(raw * 100 + 1e-9) / 100);
  return { lots, riskUSD, slPips };
}

export interface OpenPosition {
  symbol: string;
}

/** Portfolio rules applied before opening a new trade. Returns a reason when blocked. */
export function portfolioBlock(signal: Signal, open: OpenPosition[], dayR: number): string | null {
  if (open.some((o) => o.symbol === signal.symbol)) return `already in a ${signal.symbol} trade`;
  if (open.length >= RISK.maxOpenTrades) return `max ${RISK.maxOpenTrades} open trades`;
  if (dayR <= RISK.dailyLossLimitR) return `daily loss limit ${RISK.dailyLossLimitR}R reached`;
  const cfg = symbolConfig(signal.symbol);
  for (const cur of [cfg.base, cfg.quote]) {
    const n = open.filter((o) => {
      const c = symbolConfig(o.symbol);
      return c.base === cur || c.quote === cur;
    }).length;
    if (n >= RISK.maxPerCurrency) return `max ${RISK.maxPerCurrency} trades on ${cur}`;
  }
  return null;
}
