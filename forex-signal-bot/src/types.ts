export interface Candle {
  /** Candle open time, unix ms (UTC). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type Side = "BUY" | "SELL";

export interface Signal {
  symbol: string;
  side: Side;
  /** Open time of the 5m candle whose close produced the signal. */
  candleTime: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  atr: number;
  rsi: number;
  reasons: string[];
}

export interface TradeResult {
  outcome: "WIN" | "LOSS" | "TIMEOUT" | "OPEN";
  /** Profit in R multiples (1R = distance from entry to stop), after spread. */
  r: number;
  exitTime?: number;
  exitPrice?: number;
}
