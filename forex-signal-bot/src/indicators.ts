/** Exponential moving average. Values before `period - 1` are NaN. */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

/** Wilder's RSI. Values before `period` are NaN. */
export function rsi(closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const calc = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = calc();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = calc();
  }
  return out;
}

/** Wilder's Average True Range. Values before `period` are NaN. */
export function atr(high: number[], low: number[], close: number[], period: number): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  if (n <= period) return out;
  const tr = (i: number) =>
    Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr(i);
  out[period] = sum / period;
  for (let i = period + 1; i < n; i++) out[i] = (out[i - 1] * (period - 1) + tr(i)) / period;
  return out;
}

/** Wilder's ADX (trend strength, 0-100). */
export function adx(high: number[], low: number[], close: number[], period: number): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(NaN);
  if (n <= period * 2) return out;
  let trS = 0, pS = 0, mS = 0;
  const dx = new Array<number>(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];
    const pdm = up > down && up > 0 ? up : 0;
    const mdm = down > up && down > 0 ? down : 0;
    const tr = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    if (i <= period) {
      trS += tr; pS += pdm; mS += mdm;
      if (i < period) continue;
    } else {
      trS = trS - trS / period + tr;
      pS = pS - pS / period + pdm;
      mS = mS - mS / period + mdm;
    }
    const pdi = trS ? (100 * pS) / trS : 0;
    const mdi = trS ? (100 * mS) / trS : 0;
    dx[i] = pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
  }
  let sum = 0;
  for (let i = period; i < period * 2; i++) sum += dx[i];
  out[period * 2 - 1] = sum / period;
  for (let i = period * 2; i < n; i++) out[i] = (out[i - 1] * (period - 1) + dx[i]) / period;
  return out;
}

/** Simple moving average. */
export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
