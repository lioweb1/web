"""Live loop: wait for candle close -> signal -> risk gate -> place -> settle."""

from __future__ import annotations

import asyncio
import json
import logging
import time

from .brokers import make_broker
from .datasource import make_feed
from .notify import Notifier
from .risk import RiskConfig, RiskManager
from .strategy import generate

log = logging.getLogger(__name__)


class Runner:
    def __init__(self, cfg: dict, dry_run: bool = False):
        self.cfg = cfg
        self.dry_run = dry_run
        self.symbol = cfg["symbol"]
        self.granularity = int(cfg["granularity"])
        self.expiry = int(cfg["expiry_sec"])
        self.broker = make_broker(cfg["broker"])
        self.feed = None if self.broker.provides_candles else make_feed(cfg["data"])
        self.risk = RiskManager(RiskConfig.from_dict(cfg.get("risk", {})))
        tg = cfg.get("telegram", {})
        self.notify = Notifier(tg.get("token"), tg.get("chat_id"))
        self._stop = asyncio.Event()

    # ---- data -------------------------------------------------------------
    async def _candles(self):
        src = self.broker if self.broker.provides_candles else self.feed
        return await src.candles(self.symbol, self.granularity, int(self.cfg["history"]))

    async def _spot(self, symbol: str) -> float:
        src = self.broker if self.broker.provides_candles else self.feed
        return await src.spot(symbol)

    async def _sleep_to_next_close(self) -> None:
        now = time.time()
        next_close = (int(now // self.granularity) + 1) * self.granularity
        await asyncio.sleep(max(0.0, next_close - now + 1.0))  # +1s so the candle is final

    # ---- loop ---------------------------------------------------------------
    async def run(self) -> None:
        await self.broker.connect()
        if self.feed:
            await self.feed.connect()
        if hasattr(self.broker, "price_feed") and self.broker.price_feed is None:
            self.broker.price_feed = self._spot
        bal = await self.broker.balance()
        mode = "DRY-RUN" if self.dry_run else self.broker.name
        self.notify.send(f"🤖 bot started · {self.symbol} · {self.expiry}s · {mode} · balance {bal:.2f}")
        try:
            while not self._stop.is_set():
                await self._sleep_to_next_close()
                try:
                    await self._tick()
                except Exception as exc:  # noqa: BLE001 - keep the loop alive
                    log.exception("tick failed: %s", exc)
                    self.notify.send(f"⚠️ error: {exc}")
                    await asyncio.sleep(5)
        finally:
            await self.broker.close()
            if self.feed:
                await self.feed.close()
            self.notify.send(f"🛑 bot stopped · {json.dumps(self.risk.summary())}")

    async def _tick(self) -> None:
        df = await self._candles()
        # Drop the still-forming candle if the feed included it.
        current_open = int(time.time() // self.granularity) * self.granularity
        df = df[df["time"] < current_open]
        sig = generate(df, self.cfg["strategy"])
        log.info("%s close=%.5f -> %s %.0f%% %s", self.symbol, sig.price, sig.direction, sig.confidence * 100, sig.reasons)
        if not sig.is_trade:
            return

        balance = await self.broker.balance()
        ok, why = self.risk.can_trade(balance, sig.confidence)
        if not ok:
            log.info("skip: %s", why)
            return
        stake = self.risk.stake_for(balance)
        self.notify.signal(self.broker.name, self.symbol, sig.direction, sig.confidence, sig.reasons, self.expiry // 60)
        if self.dry_run:
            return

        ref = await self.broker.place(self.symbol, sig.direction, stake, self.expiry)
        log.info("placed %s %s stake=%.2f ref=%s", sig.direction, self.symbol, stake, ref)
        result = await self.broker.wait_result(ref, self.expiry)
        self.risk.record(result.pnl, {"direction": sig.direction, "stake": stake, "ref": ref, "outcome": result.outcome})
        summary = self.risk.summary()
        self.notify.result(self.symbol, sig.direction, result.outcome, result.pnl, summary)
        self._append_log({"time": int(time.time()), "symbol": self.symbol, "direction": sig.direction, "stake": stake,
                          "confidence": sig.confidence, "outcome": result.outcome, "pnl": result.pnl, "ref": ref,
                          "reasons": sig.reasons})

    def _append_log(self, row: dict) -> None:
        path = self.cfg.get("log_file")
        if path:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(row) + "\n")

    def stop(self) -> None:
        self._stop.set()
