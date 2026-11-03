import json

import numpy as np
import pandas as pd

from binarybot import mtf
from binarybot.copier import parse
from binarybot.journal import AdaptiveFilter, load, report
from binarybot.optimize import walk_forward
from binarybot.strategy import CALL, NONE, PUT, Signal
from test_strategy import synthetic


def test_resample_aggregates_and_drops_partial():
    df = synthetic(23)  # 23 one-minute candles -> 4 full 5m buckets + 1 partial
    df["time"] = 1_700_000_100 + np.arange(23) * 60  # aligned to a 5m boundary
    out = mtf.resample(df, 60, 300)
    assert len(out) == 4
    first = df.iloc[:5]
    assert out["open"].iloc[0] == first["open"].iloc[0]
    assert out["close"].iloc[0] == first["close"].iloc[-1]
    assert out["high"].iloc[0] == first["high"].max()


def test_bias_detects_trend():
    n = 120
    t = np.arange(n) * 300
    up = 1.0 + np.arange(n) * 0.001
    df = pd.DataFrame({"time": t, "open": up, "high": up + 0.0005, "low": up - 0.0005, "close": up})
    assert mtf.bias(df, {})[0] == 1
    down = df.assign(open=up[::-1], high=up[::-1] + 0.0005, low=up[::-1] - 0.0005, close=up[::-1])
    assert mtf.bias(down, {})[0] == -1


def test_apply_blocks_counter_trend_and_boosts_aligned():
    sig = Signal(CALL, 0.6, ["x"], 1, 1.0)
    blocked = mtf.apply(sig, -1, "htf bearish", {})
    assert blocked.direction == NONE
    boosted = mtf.apply(Signal(PUT, 0.6, ["x"], 1, 1.0), -1, "htf bearish", {"htf_bonus": 0.2})
    assert boosted.direction == PUT and abs(boosted.confidence - 0.8) < 1e-9
    neutral_req = mtf.apply(Signal(CALL, 0.6, ["x"], 1, 1.0), 0, "htf neutral", {"htf_mode": "require"})
    assert neutral_req.direction == NONE


def _write_log(path, rows):
    with open(path, "w") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")


def test_journal_report_and_filter(tmp_path):
    log = tmp_path / "trades.log"
    rows = []
    t = 1_700_000_000
    for i in range(40):
        sym = "GOOD" if i % 2 == 0 else "BAD"
        won = (i % 4 != 3) if sym == "GOOD" else (i % 4 == 1)  # GOOD 75%, BAD 25%
        rows.append({"time": t + i * 3600, "symbol": sym, "direction": "CALL", "stake": 1, "confidence": 0.8,
                     "outcome": "win" if won else "loss", "pnl": 0.85 if won else -1.0, "strategy": "mr", "broker": "paper"})
    _write_log(log, rows)
    df = load(log)
    rep = report(df)
    assert rep["summary"]["trades"] == 40
    assert rep["by_symbol"].loc["GOOD", "win_rate"] > rep["by_symbol"].loc["BAD", "win_rate"]
    f = AdaptiveFilter(str(log), min_trades=10)
    assert f.check("GOOD", 12)[0]
    ok, why = f.check("BAD", 12)
    assert not ok and "BAD" in why


def test_walk_forward_ranks_candidates():
    df = synthetic(2400, seed=11)
    space = {"rsi_oversold": [25, 30], "min_confidence": [0.6, 0.8], "htf_mode": ["off"]}
    ranked = walk_forward(df, {"strategies": ["mean_reversion"]}, space=space, n_samples=None, folds=2,
                          htf_granularity=None, min_oos_trades=0)
    assert len(ranked) == 4
    assert ranked[0].score >= ranked[-1].score
    assert all(len(c.folds) == 2 for c in ranked)


def test_copier_parser_formats():
    s = parse("🔥 EUR/USD CALL 1M 🔥")
    assert s and s.symbol == "EURUSD" and s.direction == "CALL" and s.expiry_sec == 60
    s = parse("GBPUSD-OTC\n🔴 PUT\nExpiry: 5 min")
    assert s and s.symbol == "GBPUSD_otc" and s.direction == "PUT" and s.expiry_sec == 300
    s = parse("DOWN  AUD/JPY  3 minutes")
    assert s and s.symbol == "AUDJPY" and s.direction == "PUT" and s.expiry_sec == 180
    s = parse("USD/CAD 🟢", default_expiry_sec=120)
    assert s and s.direction == "CALL" and s.expiry_sec == 120
    assert parse("good morning traders") is None
    s = parse("EUR/USD UP 1m", symbol_map={"EUR/USD": "frxEURUSD"})
    assert s.symbol == "frxEURUSD"
