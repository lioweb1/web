"""End-to-end smoke test of the live loop with a stub feed and stub broker."""

import asyncio

import pandas as pd

from binarybot.brokers.base import BrokerAdapter, TradeResult
from binarybot.config import load
from binarybot.runner import Runner
from binarybot.strategy import CALL, Signal


class StubBroker(BrokerAdapter):
    name = "stub"
    provides_candles = True

    def __init__(self):
        self.placed = []
        self._bal = 100.0

    async def balance(self):
        return self._bal

    async def candles(self, symbol, granularity, count):
        t = [1_700_000_000 + i * 60 for i in range(count)]
        return pd.DataFrame({"time": t, "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0})

    async def place(self, symbol, direction, stake, expiry_sec):
        self.placed.append((symbol, direction, stake, expiry_sec))
        return "ref1"

    async def wait_result(self, ref, expiry_sec):
        self._bal += 0.85
        return TradeResult("win", 0.85, ref)


def test_tick_places_trade_and_records(monkeypatch, tmp_path):
    cfg = load(None)
    cfg["log_file"] = str(tmp_path / "trades.log")
    cfg["risk"] = {"trade_hours_utc": None, "cooldown_after_loss_sec": 0}
    runner = Runner(cfg, dry_run=False)
    runner.broker = StubBroker()
    runner.feed = None
    monkeypatch.setattr("binarybot.runner.generate", lambda df, p: Signal(CALL, 0.8, ["stub"], 1, 1.0))

    asyncio.run(runner._tick())

    assert runner.broker.placed == [("frxEURUSD", CALL, 1.0, 60)]
    assert runner.risk.summary()["wins"] == 1
    assert (tmp_path / "trades.log").read_text().count("\n") == 1


def test_dry_run_places_nothing(monkeypatch):
    cfg = load(None)
    cfg["log_file"] = None
    cfg["risk"] = {"trade_hours_utc": None}
    runner = Runner(cfg, dry_run=True)
    runner.broker = StubBroker()
    monkeypatch.setattr("binarybot.runner.generate", lambda df, p: Signal(CALL, 0.9, ["stub"], 1, 1.0))
    asyncio.run(runner._tick())
    assert runner.broker.placed == []


def test_risk_gate_blocks_low_confidence(monkeypatch):
    cfg = load(None)
    cfg["log_file"] = None
    cfg["risk"] = {"trade_hours_utc": None, "min_confidence": 0.9}
    runner = Runner(cfg)
    runner.broker = StubBroker()
    monkeypatch.setattr("binarybot.runner.generate", lambda df, p: Signal(CALL, 0.6, ["stub"], 1, 1.0))
    asyncio.run(runner._tick())
    assert runner.broker.placed == []
