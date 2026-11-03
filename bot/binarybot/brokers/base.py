"""Abstract broker interface. Keep it tiny so new brokers are cheap to add."""

from __future__ import annotations

import abc
from dataclasses import dataclass

import pandas as pd


@dataclass
class TradeResult:
    outcome: str      # win | loss | tie | unknown
    pnl: float        # realised profit in account currency
    ref: str = ""     # broker contract id, if any


class BrokerAdapter(abc.ABC):
    name: str = "base"

    #: True when the adapter can stream its own candles. Otherwise the runner
    #: uses the configured external data source for the same symbol.
    provides_candles: bool = False

    async def connect(self) -> None:  # noqa: B027 - optional hook
        pass

    async def close(self) -> None:  # noqa: B027
        pass

    @abc.abstractmethod
    async def balance(self) -> float: ...

    async def candles(self, symbol: str, granularity: int, count: int) -> pd.DataFrame:
        raise NotImplementedError(f"{self.name} does not provide candles")

    @abc.abstractmethod
    async def place(self, symbol: str, direction: str, stake: float, expiry_sec: int) -> str:
        """Open a contract. Returns a reference used by wait_result."""

    @abc.abstractmethod
    async def wait_result(self, ref: str, expiry_sec: int) -> TradeResult: ...
