"""Signal generation.

Every strategy receives an indicator-enriched candle frame and returns a Signal
for the *last closed* candle. Strategies never touch the broker; they only
decide direction + confidence. Add new ones to STRATEGIES.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import pandas as pd

from .indicators import enrich

CALL = "CALL"
PUT = "PUT"
NONE = "NONE"


@dataclass
class Signal:
    direction: str = NONE
    confidence: float = 0.0  # 0..1, number of confirmations / max
    reasons: list[str] = field(default_factory=list)
    time: int = 0
    price: float = 0.0

    @property
    def is_trade(self) -> bool:
        return self.direction in (CALL, PUT)


def _last(df: pd.DataFrame, n: int = 1) -> pd.Series:
    return df.iloc[-n]


def mean_reversion(df: pd.DataFrame, p: dict) -> Signal:
    """RSI + Bollinger extreme, confirmed by a reversal candle and stochastic.

    CALL when price pierced the lower band while oversold and the last candle
    closed bullish back toward the band. Mirror for PUT. The trend filter blocks
    counter-trend trades when the EMA(50) slope is steep.
    """
    if len(df) < max(p.get("ema_trend", 50), p.get("bb_period", 20)) + 5:
        return Signal()
    c, prev = _last(df, 1), _last(df, 2)
    if c[["rsi", "bb_lower", "bb_upper", "stoch_k", "ema_trend", "atr"]].isna().any():
        return Signal()

    rsi_lo, rsi_hi = p.get("rsi_oversold", 30), p.get("rsi_overbought", 70)
    min_conf = p.get("min_confidence", 0.6)
    slope = (c["ema_trend"] - df["ema_trend"].iloc[-6]) / max(c["atr"], 1e-9)
    strong_trend = abs(slope) > p.get("max_trend_slope_atr", 1.5)

    reasons: list[str] = []
    checks_call = [
        (prev["low"] <= prev["bb_lower"] or c["low"] <= c["bb_lower"], "touched lower band"),
        (c["rsi"] <= rsi_lo or prev["rsi"] <= rsi_lo, f"rsi oversold ({c['rsi']:.1f})"),
        (c["close"] > c["open"], "bullish reversal candle"),
        (c["stoch_k"] < 25 or (c["stoch_k"] > c["stoch_d"] and prev["stoch_k"] < 25), "stochastic turning up"),
        (c["close"] > c["bb_lower"], "closed back inside band"),
    ]
    checks_put = [
        (prev["high"] >= prev["bb_upper"] or c["high"] >= c["bb_upper"], "touched upper band"),
        (c["rsi"] >= rsi_hi or prev["rsi"] >= rsi_hi, f"rsi overbought ({c['rsi']:.1f})"),
        (c["close"] < c["open"], "bearish reversal candle"),
        (c["stoch_k"] > 75 or (c["stoch_k"] < c["stoch_d"] and prev["stoch_k"] > 75), "stochastic turning down"),
        (c["close"] < c["bb_upper"], "closed back inside band"),
    ]

    def score(checks):
        hits = [r for ok, r in checks if ok]
        return len(hits) / len(checks), hits

    call_conf, call_hits = score(checks_call)
    put_conf, put_hits = score(checks_put)

    # Primary conditions: band touch + rsi extreme + a reversal candle.
    # Without the reversal candle we would be catching a falling knife.
    call_primary = checks_call[0][0] and checks_call[1][0] and checks_call[2][0]
    put_primary = checks_put[0][0] and checks_put[1][0] and checks_put[2][0]

    if call_primary and call_conf >= min_conf and not (strong_trend and slope < 0):
        return Signal(CALL, call_conf, call_hits, int(c["time"]), float(c["close"]))
    if put_primary and put_conf >= min_conf and not (strong_trend and slope > 0):
        return Signal(PUT, put_conf, put_hits, int(c["time"]), float(c["close"]))
    reasons = ["no setup"]
    return Signal(NONE, 0.0, reasons, int(c["time"]), float(c["close"]))


def trend_pullback(df: pd.DataFrame, p: dict) -> Signal:
    """Trade with the EMA trend after a pullback to the fast EMA.

    CALL when ema_fast > ema_slow > ema_trend, price dipped to ema_fast and the
    last candle closed bullish with RSI between 40 and 60 (not yet overbought).
    """
    if len(df) < p.get("ema_trend", 50) + 5:
        return Signal()
    c, prev = _last(df, 1), _last(df, 2)
    if c[["ema_fast", "ema_slow", "ema_trend", "rsi", "macd_hist"]].isna().any():
        return Signal()
    min_conf = p.get("min_confidence", 0.6)
    up = c["ema_fast"] > c["ema_slow"] > c["ema_trend"]
    down = c["ema_fast"] < c["ema_slow"] < c["ema_trend"]

    checks_call = [
        (up, "ema stack bullish"),
        (prev["low"] <= prev["ema_fast"] or c["low"] <= c["ema_fast"], "pullback to fast ema"),
        (c["close"] > c["open"] and c["close"] > c["ema_fast"], "bullish close above fast ema"),
        (40 <= c["rsi"] <= 62, f"rsi neutral ({c['rsi']:.1f})"),
        (c["macd_hist"] > prev["macd_hist"], "macd momentum rising"),
    ]
    checks_put = [
        (down, "ema stack bearish"),
        (prev["high"] >= prev["ema_fast"] or c["high"] >= c["ema_fast"], "pullback to fast ema"),
        (c["close"] < c["open"] and c["close"] < c["ema_fast"], "bearish close below fast ema"),
        (38 <= c["rsi"] <= 60, f"rsi neutral ({c['rsi']:.1f})"),
        (c["macd_hist"] < prev["macd_hist"], "macd momentum falling"),
    ]

    def score(checks):
        hits = [r for ok, r in checks if ok]
        return len(hits) / len(checks), hits

    cc, ch = score(checks_call)
    pc, ph = score(checks_put)
    if up and checks_call[1][0] and cc >= min_conf:
        return Signal(CALL, cc, ch, int(c["time"]), float(c["close"]))
    if down and checks_put[1][0] and pc >= min_conf:
        return Signal(PUT, pc, ph, int(c["time"]), float(c["close"]))
    return Signal(NONE, 0.0, ["no setup"], int(c["time"]), float(c["close"]))


STRATEGIES: dict[str, Callable[[pd.DataFrame, dict], Signal]] = {
    "mean_reversion": mean_reversion,
    "trend_pullback": trend_pullback,
}


def generate(raw: pd.DataFrame, params: dict) -> Signal:
    """Enrich the frame and run the configured strategy (or vote across several)."""
    names = params.get("strategies") or [params.get("strategy", "mean_reversion")]
    df = enrich(raw, params)
    signals = [STRATEGIES[n](df, params) for n in names]
    trades = [s for s in signals if s.is_trade]
    if not trades:
        return signals[0] if signals else Signal()
    if len(names) == 1:
        return trades[0]
    # Multi-strategy: require agreement, pick the highest confidence.
    dirs = {s.direction for s in trades}
    if len(dirs) > 1:
        return Signal(NONE, 0.0, ["strategies disagree"], trades[0].time, trades[0].price)
    best = max(trades, key=lambda s: s.confidence)
    best.reasons = [f"{len(trades)}/{len(names)} strategies agree"] + best.reasons
    return best
