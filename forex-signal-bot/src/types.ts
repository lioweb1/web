export interface Candle {
  /** Candle open time, unix ms (UTC). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type Side = "BUY" | "SELL";
export type Setup = "TREND_PULLBACK" | "BREAKOUT";

export interface ScoreFactor {
  label: string;
  points: number;
  max: number;
}

export interface Signal {
  id: string;
  symbol: string;
  setup: Setup;
  side: Side;
  /** Open time of the 5m candle whose close produced the signal. */
  candleTime: number;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  atr: number;
  /** Strength score 0-100: how many quality factors agree. Not a win probability. */
  score: number;
  factors: ScoreFactor[];
}

export interface TradeResult {
  outcome: "WIN" | "PARTIAL" | "BREAKEVEN" | "LOSS" | "TIMEOUT" | "OPEN";
  /** Profit in R (1R = entry-to-stop distance), after spread. */
  r: number;
  tp1Hit: boolean;
  exitTime?: number;
  exitPrice?: number;
}
