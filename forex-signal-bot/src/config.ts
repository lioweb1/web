export interface SymbolConfig {
  /** Display name, e.g. EURUSD. */
  name: string;
  /** Yahoo Finance ticker. */
  yahoo: string;
  /** The two currencies (for news filter and exposure limits). */
  base: string;
  quote: string;
  /** One pip in price units. */
  pipSize: number;
  /** Units per 1.00 standard lot. */
  contractSize: number;
  /** Typical spread in price units. */
  spread: number;
  /** Decimals for printing prices. */
  digits: number;
}

export const SYMBOLS: SymbolConfig[] = [
  { name: "EURUSD", yahoo: "EURUSD=X", base: "EUR", quote: "USD", pipSize: 0.0001, contractSize: 100_000, spread: 0.00012, digits: 5 },
  { name: "GBPUSD", yahoo: "GBPUSD=X", base: "GBP", quote: "USD", pipSize: 0.0001, contractSize: 100_000, spread: 0.00018, digits: 5 },
  { name: "USDJPY", yahoo: "JPY=X", base: "USD", quote: "JPY", pipSize: 0.01, contractSize: 100_000, spread: 0.015, digits: 3 },
  { name: "AUDUSD", yahoo: "AUDUSD=X", base: "AUD", quote: "USD", pipSize: 0.0001, contractSize: 100_000, spread: 0.00015, digits: 5 },
  { name: "USDCAD", yahoo: "CAD=X", base: "USD", quote: "CAD", pipSize: 0.0001, contractSize: 100_000, spread: 0.0002, digits: 5 },
  { name: "USDCHF", yahoo: "CHF=X", base: "USD", quote: "CHF", pipSize: 0.0001, contractSize: 100_000, spread: 0.00018, digits: 5 },
  { name: "EURJPY", yahoo: "EURJPY=X", base: "EUR", quote: "JPY", pipSize: 0.01, contractSize: 100_000, spread: 0.02, digits: 3 },
  // Gold: Yahoo has no free spot XAUUSD intraday feed, so COMEX gold futures are used as a proxy.
  { name: "XAUUSD", yahoo: "GC=F", base: "XAU", quote: "USD", pipSize: 0.1, contractSize: 100, spread: 0.35, digits: 2 },
];

export interface StrategyParams {
  // 30m trend filter
  trendFast: number;
  trendSlow: number;
  adxPeriod: number;
  adxMin: number;
  // 5m entry
  entryFast: number;
  entrySlow: number;
  entryBaseline: number;
  rsiPeriod: number;
  breakoutLookback: number;
  // Risk / trade management, in ATR and R multiples
  atrPeriod: number;
  slAtr: number;
  tp1R: number;
  tp2R: number;
  /** Fraction closed at TP1; the stop then moves to breakeven. */
  tp1Fraction: number;
  /** Close a trade that hit neither final target nor stop after this many 5m candles (48 = 4 hours). */
  maxHoldCandles: number;
  /** Signals scoring below this (0-100) are ignored. */
  minScore: number;
  /** Only trade during London / New York sessions. */
  sessionFilter: boolean;
  enabledSetups: Array<"TREND_PULLBACK" | "BREAKOUT">;
}

export const STRATEGY: StrategyParams = {
  trendFast: 20,
  trendSlow: 50,
  adxPeriod: 14,
  adxMin: 20,
  entryFast: 9,
  entrySlow: 21,
  entryBaseline: 50,
  rsiPeriod: 14,
  breakoutLookback: 24,
  atrPeriod: 14,
  slAtr: 1.5,
  tp1R: 1,
  tp2R: 2,
  tp1Fraction: 0.5,
  maxHoldCandles: 48,
  minScore: 60,
  sessionFilter: true,
  enabledSetups: ["TREND_PULLBACK", "BREAKOUT"],
};

export const RISK = {
  /** Starting balance of the paper account, USD. */
  startingBalance: 10_000,
  /** Percent of balance risked per trade. */
  riskPercent: 1,
  maxOpenTrades: 3,
  /** Stop opening trades for the rest of the UTC day once the day's result reaches this many R. */
  dailyLossLimitR: -3,
  /** Max open trades that involve the same currency (e.g. USD). */
  maxPerCurrency: 2,
};

export const NEWS = {
  enabled: true,
  /** Block new signals this many minutes before and after a high-impact event. */
  windowMinutes: 30,
  calendarUrl: "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
};

export const DASHBOARD_PORT = Number(process.env.PORT ?? 3100);

export const FIVE_MIN = 5 * 60_000;
export const THIRTY_MIN = 30 * 60_000;

export function symbolConfig(name: string): SymbolConfig {
  const cfg = SYMBOLS.find((s) => s.name === name);
  if (!cfg) throw new Error(`Unknown symbol ${name}`);
  return cfg;
}
