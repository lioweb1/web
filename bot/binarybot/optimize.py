"""Parameter optimizer with walk-forward validation.

Random/grid search over a parameter space, scored on an in-sample window and
validated on the following out-of-sample window, rolling forward. The final
ranking uses out-of-sample results only, which is the honest number.
"""

from __future__ import annotations

import itertools
import random
from dataclasses import dataclass, field

import pandas as pd

from .backtest import run_backtest

DEFAULT_SPACE: dict[str, list] = {
    "rsi_oversold": [20, 25, 30, 35],
    "rsi_overbought": [65, 70, 75, 80],
    "bb_period": [14, 20, 26],
    "bb_std": [1.8, 2.0, 2.3, 2.6],
    "min_confidence": [0.6, 0.8, 1.0],
    "max_trend_slope_atr": [1.0, 1.5, 2.5],
    "htf_mode": ["off", "filter", "require"],
}


@dataclass
class Candidate:
    params: dict
    is_trades: int = 0
    is_win_rate: float = 0.0
    is_net: float = 0.0
    oos_trades: int = 0
    oos_win_rate: float = 0.0
    oos_net: float = 0.0
    oos_drawdown: float = 0.0
    folds: list[dict] = field(default_factory=list)

    @property
    def score(self) -> float:
        """Out-of-sample net per trade, penalised for too few trades."""
        if self.oos_trades == 0:
            return -99.0
        per_trade = self.oos_net / self.oos_trades
        confidence = min(1.0, self.oos_trades / 100.0)
        return per_trade * confidence - 0.002 * self.oos_drawdown


def _combos(space: dict, n: int | None, seed: int) -> list[dict]:
    keys = list(space)
    all_combos = [dict(zip(keys, vals)) for vals in itertools.product(*(space[k] for k in keys))]
    if n is None or n >= len(all_combos):
        return all_combos
    rng = random.Random(seed)
    return rng.sample(all_combos, n)


def walk_forward(
    candles: pd.DataFrame,
    base_params: dict,
    space: dict | None = None,
    n_samples: int | None = 60,
    folds: int = 4,
    train_frac: float = 0.7,
    expiry_candles: int = 1,
    payout: float = 0.85,
    granularity: int = 60,
    htf_granularity: int | None = 300,
    min_oos_trades: int = 20,
    seed: int = 42,
    progress=None,
) -> list[Candidate]:
    space = space or DEFAULT_SPACE
    combos = _combos(space, n_samples, seed)
    n = len(candles)
    fold_len = n // folds
    results: list[Candidate] = []
    for idx, override in enumerate(combos):
        params = {**base_params, **override}
        cand = Candidate(params=override)
        for f in range(folds):
            chunk = candles.iloc[f * fold_len : (f + 1) * fold_len].reset_index(drop=True)
            split = int(len(chunk) * train_frac)
            train, test = chunk.iloc[:split], chunk.iloc[split - 200 :].reset_index(drop=True)  # 200 candle warm-up overlap
            kw = dict(expiry_candles=expiry_candles, payout=payout, min_confidence=params.get("min_confidence", 0.6),
                      granularity=granularity, htf_granularity=htf_granularity)
            r_is = run_backtest(train, params, **kw)
            r_oos = run_backtest(test, params, warmup=200, **kw)
            cand.is_trades += len(r_is.trades)
            cand.is_net += r_is.net_units
            cand.oos_trades += len(r_oos.trades)
            cand.oos_net += r_oos.net_units
            cand.oos_drawdown = max(cand.oos_drawdown, r_oos.max_drawdown_units)
            cand.folds.append({"fold": f, "is_wr": r_is.win_rate, "is_n": len(r_is.trades), "oos_wr": r_oos.win_rate, "oos_n": len(r_oos.trades), "oos_net": r_oos.net_units})
        if cand.oos_trades:
            wins = sum(fd["oos_wr"] * fd["oos_n"] for fd in cand.folds) / cand.oos_trades
            cand.oos_win_rate = wins
        if cand.is_trades:
            cand.is_win_rate = sum(fd["is_wr"] * fd["is_n"] for fd in cand.folds) / cand.is_trades
        results.append(cand)
        if progress:
            progress(idx + 1, len(combos), cand)
    results = [c for c in results if c.oos_trades >= min_oos_trades] or results
    return sorted(results, key=lambda c: c.score, reverse=True)


def format_results(ranked: list[Candidate], payout: float, top: int = 10) -> str:
    be = 100.0 / (1.0 + payout)
    lines = [f"breakeven win rate {be:.1f}%   (ranked by out-of-sample net per trade)", ""]
    for i, c in enumerate(ranked[:top], 1):
        lines.append(
            f"#{i:<2} oos: n={c.oos_trades:<4} wr={c.oos_win_rate:5.1f}% net={c.oos_net:+7.2f} dd={c.oos_drawdown:5.1f} | "
            f"is: n={c.is_trades:<4} wr={c.is_win_rate:5.1f}% net={c.is_net:+7.2f}"
        )
        lines.append("    " + ", ".join(f"{k}={v}" for k, v in c.params.items()))
    if ranked:
        consistent = sum(1 for fd in ranked[0].folds if fd["oos_net"] > 0)
        lines.append(f"\nbest candidate positive in {consistent}/{len(ranked[0].folds)} out-of-sample folds")
    return "\n".join(lines)
