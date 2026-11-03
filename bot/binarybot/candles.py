"""Candle container and helpers shared by every data source."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

COLUMNS = ["time", "open", "high", "low", "close"]


@dataclass(frozen=True)
class Candle:
    time: int  # epoch seconds, candle open time
    open: float
    high: float
    low: float
    close: float

    @property
    def is_bull(self) -> bool:
        return self.close > self.open

    @property
    def body(self) -> float:
        return abs(self.close - self.open)

    @property
    def range(self) -> float:
        return self.high - self.low


def to_frame(candles: list[Candle] | list[dict]) -> pd.DataFrame:
    """Normalise a list of Candle or dict rows into a sorted DataFrame."""
    if not candles:
        return pd.DataFrame(columns=COLUMNS)
    if isinstance(candles[0], Candle):
        rows = [c.__dict__ for c in candles]
    else:
        rows = candles
    df = pd.DataFrame(rows)[COLUMNS].astype(
        {"time": "int64", "open": "float64", "high": "float64", "low": "float64", "close": "float64"}
    )
    df = df.drop_duplicates("time").sort_values("time").reset_index(drop=True)
    return df


def append_candle(df: pd.DataFrame, candle: Candle, max_len: int = 1000) -> pd.DataFrame:
    """Append or replace the candle with the same open time, trimming history."""
    row = pd.DataFrame([candle.__dict__])[COLUMNS]
    if len(df) and df["time"].iloc[-1] == candle.time:
        df = df.iloc[:-1]
    df = pd.concat([df, row], ignore_index=True)
    if len(df) > max_len:
        df = df.iloc[-max_len:].reset_index(drop=True)
    return df
