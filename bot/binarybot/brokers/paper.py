"""Paper broker: settles against the live data feed, touches no real account."""

from __future__ import annotations

import asyncio
import time
import uuid

from .base import BrokerAdapter, TradeResult


class PaperBroker(BrokerAdapter):
    name = "paper"

    def __init__(self, start_balance: float = 1000.0, payout: float = 0.85, price_feed=None):
        self._balance = float(start_balance)
        self.payout = float(payout)
        self.price_feed = price_feed  # async callable(symbol) -> float, set by runner
        self._open: dict[str, dict] = {}

    async def balance(self) -> float:
        return self._balance

    async def place(self, symbol: str, direction: str, stake: float, expiry_sec: int) -> str:
        entry = await self.price_feed(symbol)
        ref = uuid.uuid4().hex[:8]
        self._open[ref] = {"symbol": symbol, "direction": direction, "stake": stake, "entry": entry, "opened": time.time()}
        self._balance -= stake
        return ref

    async def wait_result(self, ref: str, expiry_sec: int) -> TradeResult:
        t = self._open.pop(ref)
        remaining = t["opened"] + expiry_sec - time.time()
        if remaining > 0:
            await asyncio.sleep(remaining)
        exit_ = await self.price_feed(t["symbol"])
        if exit_ == t["entry"]:
            self._balance += t["stake"]
            return TradeResult("tie", 0.0, ref)
        won = exit_ > t["entry"] if t["direction"] == "CALL" else exit_ < t["entry"]
        if won:
            gain = t["stake"] * self.payout
            self._balance += t["stake"] + gain
            return TradeResult("win", gain, ref)
        return TradeResult("loss", -t["stake"], ref)
