export interface SymbolConfig {
  /** Display name, e.g. EURUSD. */
  name: string;
  /** Yahoo Finance ticker. */
  yahoo: string;
  /** Typical spread in price units (e.g. 1.2 pips on EURUSD = 0.00012). */
  spread: number;
  /** Decimals for printing prices. */
  digits: number;
}

export const SYMBOLS: SymbolConfig[] = [
  { name: "EURUSD", yahoo: "EURUSD=X", spread: 0.00012, digits: 5 },
  { name: "GBPUSD", yahoo: "GBPUSD=X", spread: 0.00018, digits: 5 },
  { name: "USDJPY", yahoo: "JPY=X", spread: 0.015, digits: 3 },
  { name: "AUDUSD", yahoo: "AUDUSD=X", spread: 0.00015, digits: 5 },
  { name: "USDCAD", yahoo: "CAD=X", spread: 0.0002, digits: 5 },
];

export const STRATEGY = {
  // 30m trend filter
  trendFast: 20,
  trendSlow: 50,
  // 5m entry trigger
  entryFast: 9,
  entrySlow: 21,
  entryBaseline: 50,
  rsiPeriod: 14,
  rsiBuyMin: 50,
  rsiBuyMax: 70,
  rsiSellMin: 30,
  rsiSellMax: 50,
  // Risk
  atrPeriod: 14,
  slAtr: 1.5,
  tpAtr: 2.25, // 1.5R target
  /** Close a trade that hit neither SL nor TP after this many 5m candles (48 = 4 hours). */
  maxHoldCandles: 48,
};

export const FIVE_MIN = 5 * 60_000;
export const THIRTY_MIN = 30 * 60_000;
