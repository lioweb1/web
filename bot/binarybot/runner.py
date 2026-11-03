"""Live loop.

Every base-candle close:
  for each symbol -> candles (+ higher timeframe) -> signal
  rank trade signals by confidence -> risk gate -> journal filter -> place
  trades settle concurrently (up to risk.max_concurrent_trades)

Optional services wired in by config: local signal server (Chrome extension),
license client (dashboard), Telegram notifier, adaptive journal filter and
the Telegram copier (external signals executed through the same gate).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid

from . import __version__, mtf
from .brokers import make_broker
from .datasource import make_feed
from .journal import AdaptiveFilter
from .license import LicenseClient
from .notify import Notifier
from .risk import RiskConfig, RiskManager
from .strategy import Signal, generate

log = logging.getLogger(__name__)


class Runner:
    def __init__(self, cfg: dict, dry_run: bool = False):
        self.cfg = cfg
        self.dry_run = dry_run
        self.symbols: list[str] = list(cfg.get("symbols") or [cfg.get("symbol", "frxEURUSD")])
        self.granularity = int(cfg["granularity"])
        self.expiry = int(cfg["expiry_sec"])
        self.history = int(cfg["history"])
        sp = cfg["strategy"]
        self.htf_granularity = int(sp.get("htf_granularity", 0) or 0) if sp.get("htf_mode", "filter") != "off" else 0
        self.max_concurrent = int(cfg.get("risk", {}).get("max_concurrent_trades", 1))
        self.max_signals_per_close = int(cfg.get("risk", {}).get("max_signals_per_close", 1))

        self.broker = make_broker(cfg["broker"])
        self.feed = None if self.broker.provides_candles else make_feed(cfg["data"])
        self.risk = RiskManager(RiskConfig.from_dict(cfg.get("risk", {})))
        tg = cfg.get("telegram", {})
        self.notify = Notifier(tg.get("token"), tg.get("chat_id"))
        jcfg = cfg.get("journal", {})
        self.journal_filter = AdaptiveFilter(cfg.get("log_file"), payout=jcfg.get("payout", 0.85),
                                             lookback_trades=jcfg.get("lookback_trades", 200), min_trades=jcfg.get("min_trades", 15),
                                             margin_pct=jcfg.get("margin_pct", 3.0), enabled=jcfg.get("auto_filter", False))
        lic = cfg.get("license", {})
        self.license = LicenseClient(lic.get("server_url"), lic.get("key"), lic.get("recheck_sec", 3600), lic.get("grace_sec", 86_400), cfg["broker"].get("kind", ""))

        srv = cfg.get("server", {})
        self.server = None
        if srv.get("enabled") or cfg["broker"].get("kind") == "extension":
            from .signal_server import SignalServer

            self.server = SignalServer(srv.get("host", "127.0.0.1"), int(srv.get("port", 8765)),
                                       hello={"symbols": self.symbols, "expiry_sec": self.expiry, "auto_trade": not dry_run})
            if hasattr(self.broker, "server"):
                self.broker.server = self.server

        self._open: set[asyncio.Task] = set()
        self._stop = asyncio.Event()

    # ---- data -------------------------------------------------------------------
    def _src(self):
        return self.broker if self.broker.provides_candles else self.feed

    async def _candles(self, symbol: str):
        df = await self._src().candles(symbol, self.granularity, self.history)
        current_open = int(time.time() // self.granularity) * self.granularity
        return df[df["time"] < current_open].reset_index(drop=True)

    async def _htf(self, symbol: str, base_df):
        if not self.htf_granularity:
            return None
        try:  # native higher-timeframe candles when the source supports them
            df = await self._src().candles(symbol, self.htf_granularity, self.history)
            current_open = int(time.time() // self.htf_granularity) * self.htf_granularity
            return df[df["time"] < current_open].reset_index(drop=True)
        except Exception:  # noqa: BLE001
            return mtf.resample(base_df, self.granularity, self.htf_granularity)

    async def _spot(self, symbol: str) -> float:
        return await self._src().spot(symbol)

    async def _sleep_to_next_close(self) -> None:
        now = time.time()
        next_close = (int(now // self.granularity) + 1) * self.granularity
        await asyncio.sleep(max(0.0, next_close - now + 1.0))

    # ---- lifecycle --------------------------------------------------------------
    async def run(self) -> None:
        ok, why = self.license.validate()
        log.info(why)
        if not ok:
            self.notify.send(f"⛔ {why}")
            return
        await self.broker.connect()
        if self.feed:
            await self.feed.connect()
        if self.server:
            await self.server.start()
        if hasattr(self.broker, "price_feed") and self.broker.price_feed is None:
            self.broker.price_feed = self._spot
        bal = await self.broker.balance()
        mode = "DRY-RUN" if self.dry_run else self.broker.name
        self.notify.send(f"🤖 binarybot {__version__} · {', '.join(self.symbols)} · {self.expiry}s · {mode} · balance {bal:.2f}")
        self._push_status(bal)
        try:
            while not self._stop.is_set():
                await self._sleep_to_next_close()
                if self.license.due():
                    ok, why = self.license.validate()
                    log.info(why)
                    if not ok:
                        self.notify.send(f"⛔ {why}")
                        break
                try:
                    await self._tick()
                except Exception as exc:  # noqa: BLE001
                    log.exception("tick failed: %s", exc)
                    self.notify.send(f"⚠️ error: {exc}")
                    await asyncio.sleep(5)
        finally:
            if self._open:
                await asyncio.gather(*self._open, return_exceptions=True)
            await self.broker.close()
            if self.feed:
                await self.feed.close()
            if self.server:
                await self.server.stop()
            self.notify.send(f"🛑 bot stopped · {json.dumps(self.risk.summary())}")

    def stop(self) -> None:
        self._stop.set()

    # ---- one candle close ---------------------------------------------------------
    async def _scan(self) -> list[tuple[str, Signal]]:
        async def one(symbol: str):
            try:
                df = await self._candles(symbol)
                htf = await self._htf(symbol, df)
                return symbol, generate(df, self.cfg["strategy"], htf)
            except Exception as exc:  # noqa: BLE001
                log.warning("%s: candle/signal error: %s", symbol, exc)
                return symbol, Signal()

        results = await asyncio.gather(*(one(s) for s in self.symbols))
        for symbol, sig in results:
            log.info("%-12s close=%.5f -> %-4s %3.0f%% %s", symbol, sig.price, sig.direction, sig.confidence * 100, "; ".join(sig.reasons[:3]))
        return [(s, sig) for s, sig in results if sig.is_trade]

    async def _tick(self) -> None:
        candidates = sorted(await self._scan(), key=lambda x: x[1].confidence, reverse=True)
        if not candidates:
            return
        self._open = {t for t in self._open if not t.done()}
        taken = 0
        for symbol, sig in candidates:
            if taken >= self.max_signals_per_close or len(self._open) >= self.max_concurrent:
                break
            if await self._execute(symbol, sig, strategy="+".join(self.cfg["strategy"].get("strategies", ["?"]))):
                taken += 1

    async def _execute(self, symbol: str, sig: Signal, strategy: str = "", expiry_sec: int | None = None) -> bool:
        """Risk gate + placement. Returns True when a trade was started (or signalled in dry run)."""
        expiry_sec = expiry_sec or self.expiry
        balance = await self.broker.balance()
        ok, why = self.risk.can_trade(balance, sig.confidence)
        if ok:
            ok, why = self.journal_filter.check(symbol, time.gmtime().tm_hour)
        if not ok:
            log.info("skip %s: %s", symbol, why)
            if self.risk.state.halted_reason and self.server:
                await self.server.broadcast({"type": "halt", "reason": self.risk.state.halted_reason})
            return False
        stake = self.risk.stake_for(balance)
        self.notify.signal(self.broker.name, symbol, sig.direction, sig.confidence, sig.reasons, expiry_sec // 60)
        if self.server and self.broker.name != "extension":  # extension broker sends its own signal frame
            await self.server.broadcast({"type": "signal", "id": uuid.uuid4().hex, "symbol": symbol, "direction": sig.direction,
                                         "confidence": sig.confidence, "expiry_sec": expiry_sec, "stake": stake,
                                         "reasons": sig.reasons, "time": int(time.time()), "informational": not self.dry_run})
        if self.dry_run:
            return True
        task = asyncio.create_task(self._trade(symbol, sig, stake, expiry_sec, strategy))
        self._open.add(task)
        return True

    async def _trade(self, symbol: str, sig: Signal, stake: float, expiry_sec: int, strategy: str) -> None:
        try:
            if self.broker.name == "extension":
                ref = await self.broker.place(symbol, sig.direction, stake, expiry_sec, confidence=sig.confidence, reasons=sig.reasons)
            else:
                ref = await self.broker.place(symbol, sig.direction, stake, expiry_sec)
            log.info("placed %s %s stake=%.2f ref=%s", sig.direction, symbol, stake, ref)
            result = await self.broker.wait_result(ref, expiry_sec)
        except Exception as exc:  # noqa: BLE001
            log.exception("trade failed on %s: %s", symbol, exc)
            self.notify.send(f"⚠️ trade failed {symbol}: {exc}")
            return
        if result.outcome in ("skipped", "unknown"):
            log.warning("%s %s: %s", symbol, sig.direction, result.outcome)
            return
        self.risk.record(result.pnl, {"symbol": symbol, "direction": sig.direction, "stake": stake, "ref": ref, "outcome": result.outcome})
        summary = self.risk.summary()
        self.notify.result(symbol, sig.direction, result.outcome, result.pnl, summary)
        row = {"time": int(time.time()), "symbol": symbol, "direction": sig.direction, "stake": stake, "confidence": sig.confidence,
               "outcome": result.outcome, "pnl": result.pnl, "ref": ref, "reasons": sig.reasons, "strategy": strategy,
               "broker": self.broker.name, "expiry_sec": expiry_sec}
        self._append_log(row)
        self.license.trade({**row, "traded_at": row["time"]})
        balance = await self.broker.balance()
        self._push_status(balance)
        if self.server:
            await self.server.broadcast({"type": "status", "summary": summary, "balance": balance})

    # ---- copier entry point ---------------------------------------------------------
    async def execute_external(self, symbol: str, direction: str, expiry_sec: int, source: str = "copier") -> bool:
        sig = Signal(direction, 1.0, [f"external signal from {source}"], int(time.time()), 0.0)
        return await self._execute(symbol, sig, strategy=source, expiry_sec=expiry_sec)

    # ---- misc -------------------------------------------------------------------------
    def _append_log(self, row: dict) -> None:
        path = self.cfg.get("log_file")
        if path:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(row) + "\n")

    def _push_status(self, balance: float) -> None:
        self.license.status(balance, self.risk.summary(), {"symbols": self.symbols, "expiry_sec": self.expiry,
                                                           "strategies": self.cfg["strategy"].get("strategies"), "dry_run": self.dry_run})


class CopierRunner(Runner):
    """Runner variant that takes its signals from Telegram instead of the strategy."""

    async def run(self) -> None:
        from .copier import Copier

        ok, why = self.license.validate()
        log.info(why)
        if not ok:
            self.notify.send(f"⛔ {why}")
            return
        await self.broker.connect()
        if self.feed:
            await self.feed.connect()
        if self.server:
            await self.server.start()
        if hasattr(self.broker, "price_feed") and self.broker.price_feed is None:
            self.broker.price_feed = self._spot
        self.notify.send(f"📡 copier started · {self.cfg['copier'].get('channels')} · {self.broker.name}")

        async def on_signal(cs):
            await self.execute_external(cs.symbol, cs.direction, cs.expiry_sec, source="copier")

        copier = Copier(self.cfg["copier"], on_signal)
        try:
            await copier.run()
        finally:
            await copier.stop()
            if self._open:
                await asyncio.gather(*self._open, return_exceptions=True)
            await self.broker.close()
            if self.feed:
                await self.feed.close()
            if self.server:
                await self.server.stop()
            self.notify.send(f"🛑 copier stopped · {json.dumps(self.risk.summary())}")
