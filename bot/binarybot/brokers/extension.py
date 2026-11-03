"""Extension broker: the Chrome extension executes trades on the broker page.

The bot only emits signals over the local SignalServer and waits for the
extension's `result` message. Balance comes from the extension's periodic
`balance` frames (falls back to a configured nominal balance for stake maths).
"""

from __future__ import annotations

import asyncio
import uuid

from .base import BrokerAdapter, TradeResult


class ExtensionBroker(BrokerAdapter):
    name = "extension"

    def __init__(self, server=None, nominal_balance: float = 100.0, require_client: bool = True):
        self.server = server  # injected by the runner
        self.nominal_balance = float(nominal_balance)
        self.require_client = require_client
        self._pending: dict[str, tuple[asyncio.Future, str, float]] = {}

    async def balance(self) -> float:
        if self.server and self.server.last_balance is not None:
            return self.server.last_balance
        return self.nominal_balance

    async def place(self, symbol: str, direction: str, stake: float, expiry_sec: int, confidence: float = 0.0, reasons=None) -> str:
        if self.require_client and self.server.connected == 0:
            raise RuntimeError("no extension connected to the signal server")
        sig_id = uuid.uuid4().hex
        fut = await self.server.send_signal(sig_id, symbol, direction, confidence, expiry_sec, stake, reasons or [])
        self._pending[sig_id] = (fut, direction, stake)
        return sig_id

    async def wait_result(self, ref: str, expiry_sec: int) -> TradeResult:
        fut, _, _ = self._pending.pop(ref)
        try:
            msg = await asyncio.wait_for(fut, expiry_sec + 60)
        except asyncio.TimeoutError:
            return TradeResult("unknown", 0.0, ref)
        if msg.get("type") == "skipped":
            return TradeResult("skipped", 0.0, ref)
        return TradeResult(msg.get("outcome", "unknown"), float(msg.get("pnl", 0.0)), ref)
