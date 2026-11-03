"""Candle feeds that are free and need no account.

- deriv  : forex (frxEURUSD...), synthetics (R_100...), crypto (cryBTCUSD). No auth needed.
- binance: spot klines (BTCUSDT...). Public REST.

Browser brokers quote their own (slightly different) prices. Use the feed for
the same underlying and keep expiries short so the difference stays negligible.
"""

from __future__ import annotations

import asyncio

import pandas as pd
import requests

from .brokers.deriv import DerivBroker
from .candles import COLUMNS


class DerivFeed:
    name = "deriv"

    def __init__(self, app_id: int = 1089):
        self._broker = DerivBroker(token=None, app_id=app_id)

    async def connect(self) -> None:
        await self._broker.connect()

    async def close(self) -> None:
        await self._broker.close()

    async def candles(self, symbol: str, granularity: int, count: int) -> pd.DataFrame:
        return await self._broker.candles(symbol, granularity, count)

    async def spot(self, symbol: str) -> float:
        return await self._broker.spot(symbol)


class BinanceFeed:
    name = "binance"
    _INTERVALS = {60: "1m", 180: "3m", 300: "5m", 900: "15m", 3600: "1h"}

    def __init__(self, base_url: str = "https://api.binance.com"):
        self.base_url = base_url

    async def connect(self) -> None:
        pass

    async def close(self) -> None:
        pass

    async def candles(self, symbol: str, granularity: int, count: int) -> pd.DataFrame:
        def _get():
            r = requests.get(
                f"{self.base_url}/api/v3/klines",
                params={"symbol": symbol, "interval": self._INTERVALS[granularity], "limit": min(count, 1000)},
                timeout=15,
            )
            r.raise_for_status()
            return r.json()

        raw = await asyncio.to_thread(_get)
        rows = [{"time": int(k[0] // 1000), "open": float(k[1]), "high": float(k[2]), "low": float(k[3]), "close": float(k[4])} for k in raw]
        return pd.DataFrame(rows, columns=COLUMNS)

    async def spot(self, symbol: str) -> float:
        def _get():
            r = requests.get(f"{self.base_url}/api/v3/ticker/price", params={"symbol": symbol}, timeout=10)
            r.raise_for_status()
            return float(r.json()["price"])

        return await asyncio.to_thread(_get)


def make_feed(cfg: dict):
    kind = cfg.get("kind", "deriv")
    if kind == "deriv":
        return DerivFeed(**cfg.get("deriv", {}))
    if kind == "binance":
        return BinanceFeed(**cfg.get("binance", {}))
    raise ValueError(f"unknown data source: {kind}")
