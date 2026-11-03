import numpy as np
import pandas as pd

from binarybot.backtest import run_backtest
from binarybot.indicators import enrich, rsi
from binarybot.strategy import CALL, PUT, generate


def synthetic(n=600, seed=7):
    rng = np.random.default_rng(seed)
    t = np.arange(n) * 60 + 1_700_000_000
    # Ornstein-Uhlenbeck style mean-reverting random walk: bands get touched,
    # but the next candle is genuinely uncertain, like a real 1m chart.
    close = np.empty(n)
    close[0] = 1.1000
    for i in range(1, n):
        close[i] = close[i - 1] + 0.03 * (1.1000 - close[i - 1]) + rng.normal(0, 0.0003)
    open_ = np.roll(close, 1)
    open_[0] = close[0]
    high = np.maximum(open_, close) + rng.uniform(0, 0.0002, n)
    low = np.minimum(open_, close) - rng.uniform(0, 0.0002, n)
    return pd.DataFrame({"time": t, "open": open_, "high": high, "low": low, "close": close})


def test_rsi_bounds():
    df = synthetic()
    r = rsi(df["close"]).dropna()
    assert ((r >= 0) & (r <= 100)).all()


def test_enrich_adds_columns():
    df = enrich(synthetic(), {})
    for col in ["ema_fast", "ema_slow", "ema_trend", "rsi", "bb_upper", "bb_lower", "atr", "stoch_k", "macd"]:
        assert col in df.columns


def test_generate_returns_valid_signal():
    df = synthetic()
    sig = generate(df, {"strategies": ["mean_reversion"]})
    assert sig.direction in (CALL, PUT, "NONE")
    assert 0.0 <= sig.confidence <= 1.0


def test_generate_short_history_is_none():
    sig = generate(synthetic(30), {})
    assert sig.direction == "NONE"


def test_backtest_produces_trades_and_stats():
    df = synthetic(1500)
    res = run_backtest(df, {"strategies": ["mean_reversion"], "min_confidence": 0.6}, expiry_candles=1, payout=0.85)
    assert len(res.trades) > 0
    assert set(res.trades["outcome"]).issubset({"win", "loss", "tie"})
    assert abs(res.breakeven_win_rate - 100 / 1.85) < 1e-6
    assert res.max_drawdown_units >= 0


def test_multi_strategy_disagreement_returns_none(monkeypatch):
    from binarybot import strategy as s
    from binarybot.strategy import Signal

    monkeypatch.setitem(s.STRATEGIES, "a", lambda df, p: Signal(CALL, 0.8, ["x"], 1, 1.0))
    monkeypatch.setitem(s.STRATEGIES, "b", lambda df, p: Signal(PUT, 0.8, ["y"], 1, 1.0))
    sig = generate(synthetic(), {"strategies": ["a", "b"]})
    assert sig.direction == "NONE"
    assert "disagree" in sig.reasons[0]
