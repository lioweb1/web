"""Event-driven backtester for fixed-expiry binary contracts."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from . import mtf
from .indicators import enrich
from .strategy import CALL, PUT, generate


@dataclass
class BacktestResult:
    trades: pd.DataFrame
    win_rate: float
    net_units: float          # in units of stake (1 = one stake)
    max_drawdown_units: float
    breakeven_win_rate: float
    by_hour: pd.DataFrame

    def __str__(self) -> str:
        n = len(self.trades)
        lines = [
            f"trades          : {n}",
            f"win rate        : {self.win_rate:.1f}%  (breakeven {self.breakeven_win_rate:.1f}%)",
            f"net (stakes)    : {self.net_units:+.2f}",
            f"max drawdown    : {self.max_drawdown_units:.2f} stakes",
        ]
        if n:
            lines.append("by hour (utc)   :")
            for h, row in self.by_hour.iterrows():
                lines.append(f"  {int(h):02d}h  n={int(row['n']):3d}  win={row['win_rate']:5.1f}%  net={row['net']:+.2f}")
        return "\n".join(lines)


def run_backtest(
    candles: pd.DataFrame,
    params: dict,
    expiry_candles: int = 1,
    payout: float = 0.85,
    warmup: int = 80,
    min_confidence: float = 0.6,
    granularity: int = 60,
    htf_granularity: int | None = None,
    progress=None,
) -> BacktestResult:
    """Walk forward candle by candle, evaluate at each close, settle at expiry close.

    `htf_granularity` (seconds) enables the multi-timeframe filter by resampling
    the same candles, exactly as the live runner would see them.
    """
    rows: list[dict] = []
    n = len(candles)
    i = warmup
    use_htf = bool(htf_granularity) and params.get("htf_mode", "filter") != "off"
    # Indicators are causal, so enriching once and slicing equals enriching each prefix.
    enriched = enrich(candles, params)
    htf_full = None
    bias_cache: dict[int, tuple[int, str]] = {}
    if use_htf:
        warmup = max(warmup, (params.get("htf_ema_slow", 50) + 5) * (htf_granularity // granularity))
        i = warmup
        htf_full = mtf.resample(candles, granularity, htf_granularity)
        htf_close_times = (htf_full["time"] + htf_granularity).to_numpy()
    while i < n - expiry_candles:
        window = enriched.iloc[: i + 1]
        htf_bias = None
        if use_htf:
            # only higher-timeframe candles that closed by this base candle's close
            k = int((htf_close_times <= int(candles["time"].iloc[i]) + granularity).sum())
            if k not in bias_cache:
                bias_cache[k] = mtf.bias(htf_full.iloc[:k], params)
            htf_bias = bias_cache[k]
        sig = generate(window, params, enriched=True, htf_bias=htf_bias)
        if progress and i % 500 == 0:
            progress(i, n)
        if sig.is_trade and sig.confidence >= min_confidence:
            entry = float(candles["close"].iloc[i])
            exit_ = float(candles["close"].iloc[i + expiry_candles])
            if exit_ == entry:
                pnl = 0.0
                outcome = "tie"
            else:
                won = (exit_ > entry) if sig.direction == CALL else (exit_ < entry)
                pnl = payout if won else -1.0
                outcome = "win" if won else "loss"
            rows.append(
                {
                    "time": int(candles["time"].iloc[i]),
                    "direction": sig.direction,
                    "confidence": sig.confidence,
                    "entry": entry,
                    "exit": exit_,
                    "outcome": outcome,
                    "pnl": pnl,
                    "reasons": "; ".join(sig.reasons),
                }
            )
            i += expiry_candles  # one open trade at a time
        i += 1

    trades = pd.DataFrame(rows)
    breakeven = 100.0 / (1.0 + payout)
    if trades.empty:
        return BacktestResult(trades, 0.0, 0.0, 0.0, breakeven, pd.DataFrame())
    decided = trades[trades["outcome"] != "tie"]
    win_rate = 100.0 * (decided["outcome"] == "win").mean() if len(decided) else 0.0
    equity = trades["pnl"].cumsum()
    drawdown = (equity.cummax() - equity).max()
    trades["hour"] = pd.to_datetime(trades["time"], unit="s").dt.hour
    by_hour = trades.groupby("hour").agg(
        n=("pnl", "size"),
        win_rate=("outcome", lambda s: 100.0 * (s == "win").sum() / max((s != "tie").sum(), 1)),
        net=("pnl", "sum"),
    )
    return BacktestResult(trades, win_rate, float(equity.iloc[-1]), float(drawdown), breakeven, by_hour)
