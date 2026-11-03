"""Multi-timeframe (MTF) bias.

The entry strategy runs on the base timeframe (e.g. 1m). A higher timeframe
(e.g. 5m) decides the *bias*: +1 bullish, -1 bearish, 0 neutral. Signals that
fight a clear higher-timeframe trend are dropped, signals that agree get a
confidence bonus. Both frames are plain candle DataFrames.
"""

from __future__ import annotations

import pandas as pd

from .indicators import ema


def resample(df: pd.DataFrame, base_sec: int, target_sec: int) -> pd.DataFrame:
    """Aggregate base candles into target-size candles (target must be a multiple)."""
    if target_sec % base_sec:
        raise ValueError("target granularity must be a multiple of the base granularity")
    if df.empty:
        return df.copy()
    bucket = (df["time"] // target_sec) * target_sec
    g = df.groupby(bucket, sort=True)
    out = pd.DataFrame(
        {
            "time": g["time"].min().index.astype("int64"),
            "open": g["open"].first().values,
            "high": g["high"].max().values,
            "low": g["low"].min().values,
            "close": g["close"].last().values,
        }
    )
    # drop a trailing partial bucket so the bias is computed on closed candles only
    complete = g["time"].count().values == target_sec // base_sec
    return out[complete].reset_index(drop=True)


def bias(htf: pd.DataFrame, p: dict) -> tuple[int, str]:
    """Return (bias, reason) from EMA stack and slope on the higher timeframe."""
    fast_n, slow_n = p.get("htf_ema_fast", 20), p.get("htf_ema_slow", 50)
    if len(htf) < slow_n + 3:
        return 0, "htf: not enough candles"
    fast = ema(htf["close"], fast_n)
    slow = ema(htf["close"], slow_n)
    close = htf["close"].iloc[-1]
    f, s = fast.iloc[-1], slow.iloc[-1]
    slope = (s - slow.iloc[-4]) / max(abs(s), 1e-9)  # relative slope over 3 htf candles
    min_slope = p.get("htf_min_slope", 0.0002)
    if f > s and close > s and slope > min_slope:
        return 1, f"htf bullish (ema{fast_n}>ema{slow_n}, slope {slope:.2%})"
    if f < s and close < s and slope < -min_slope:
        return -1, f"htf bearish (ema{fast_n}<ema{slow_n}, slope {slope:.2%})"
    return 0, "htf neutral"


def apply(signal, htf_bias: int, reason: str, p: dict):
    """Mutate a Signal according to the bias and the configured mode.

    mode "filter": drop counter-trend signals, bonus for aligned ones (default).
    mode "require": only trade when aligned.
    mode "off": no change.
    """
    from .strategy import CALL, NONE, PUT, Signal

    mode = p.get("htf_mode", "filter")
    if mode == "off" or not signal.is_trade:
        return signal
    want = 1 if signal.direction == CALL else -1
    if htf_bias == want:
        signal.confidence = min(1.0, signal.confidence + p.get("htf_bonus", 0.1))
        signal.reasons = [reason] + signal.reasons
        return signal
    if htf_bias == -want or (mode == "require" and htf_bias == 0):
        return Signal(NONE, 0.0, [f"blocked by {reason}"], signal.time, signal.price)
    return signal
