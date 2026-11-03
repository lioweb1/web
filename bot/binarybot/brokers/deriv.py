"""Deriv adapter using the official WebSocket API (https://api.deriv.com).

Works on demo (VRTC...) and real accounts. Candles are public, so this adapter
also doubles as a free data source for forex/synthetic symbols even when you
execute on a different broker.
"""

from __future__ import annotations

import asyncio
import json
import logging

import pandas as pd
import websockets

from ..candles import COLUMNS
from .base import BrokerAdapter, TradeResult

log = logging.getLogger(__name__)

DEFAULT_APP_ID = 1089  # Deriv's public test app id; register your own for production.


class DerivBroker(BrokerAdapter):
    name = "deriv"
    provides_candles = True

    def __init__(self, token: str | None = None, app_id: int = DEFAULT_APP_ID, currency: str = "USD", endpoint: str = "ws.derivws.com"):
        self.token = token
        self.url = f"wss://{endpoint}/websockets/v3?app_id={app_id}"
        self.currency = currency
        self._ws = None
        self._req_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._subs: dict[str, asyncio.Queue] = {}
        self._reader: asyncio.Task | None = None

    # ---- transport ----------------------------------------------------------
    async def connect(self) -> None:
        self._ws = await websockets.connect(self.url, ping_interval=20)
        self._reader = asyncio.create_task(self._read_loop())
        if self.token:
            auth = await self._call({"authorize": self.token})
            acct = auth["authorize"]
            log.info("deriv authorised: %s (%s, %s)", acct.get("loginid"), acct.get("currency"), "demo" if acct.get("is_virtual") else "REAL")

    async def close(self) -> None:
        if self._reader:
            self._reader.cancel()
        if self._ws:
            await self._ws.close()

    async def _read_loop(self) -> None:
        async for raw in self._ws:
            msg = json.loads(raw)
            req_id = msg.get("req_id")
            sub_id = (msg.get("subscription") or {}).get("id")
            if req_id in self._pending and not self._pending[req_id].done():
                self._pending.pop(req_id).set_result(msg)
            elif sub_id in self._subs:
                await self._subs[sub_id].put(msg)

    async def _call(self, payload: dict, timeout: float = 20) -> dict:
        self._req_id += 1
        payload["req_id"] = self._req_id
        fut = asyncio.get_running_loop().create_future()
        self._pending[self._req_id] = fut
        await self._ws.send(json.dumps(payload))
        msg = await asyncio.wait_for(fut, timeout)
        if "error" in msg:
            raise RuntimeError(f"deriv {payload.get('msg_type', list(payload)[0])}: {msg['error'].get('message')}")
        return msg

    # ---- account --------------------------------------------------------------
    async def balance(self) -> float:
        msg = await self._call({"balance": 1})
        return float(msg["balance"]["balance"])

    # ---- data -----------------------------------------------------------------
    async def candles(self, symbol: str, granularity: int, count: int) -> pd.DataFrame:
        msg = await self._call(
            {"ticks_history": symbol, "style": "candles", "granularity": granularity, "count": count, "end": "latest"}
        )
        rows = [
            {"time": int(c["epoch"]), "open": float(c["open"]), "high": float(c["high"]), "low": float(c["low"]), "close": float(c["close"])}
            for c in msg["candles"]
        ]
        return pd.DataFrame(rows, columns=COLUMNS)

    async def spot(self, symbol: str) -> float:
        msg = await self._call({"ticks_history": symbol, "style": "ticks", "count": 1, "end": "latest"})
        return float(msg["history"]["prices"][-1])

    # ---- trading ----------------------------------------------------------------
    async def place(self, symbol: str, direction: str, stake: float, expiry_sec: int) -> str:
        if expiry_sec % 60 == 0:
            duration, unit = expiry_sec // 60, "m"
        else:
            duration, unit = expiry_sec, "s"
        msg = await self._call(
            {
                "buy": 1,
                "price": stake,
                "parameters": {
                    "amount": stake,
                    "basis": "stake",
                    "contract_type": direction,  # CALL | PUT
                    "currency": self.currency,
                    "duration": duration,
                    "duration_unit": unit,
                    "symbol": symbol,
                },
            }
        )
        return str(msg["buy"]["contract_id"])

    async def wait_result(self, ref: str, expiry_sec: int) -> TradeResult:
        msg = await self._call({"proposal_open_contract": 1, "contract_id": int(ref), "subscribe": 1})
        sub_id = msg["subscription"]["id"]
        queue: asyncio.Queue = asyncio.Queue()
        self._subs[sub_id] = queue
        try:
            poc = msg["proposal_open_contract"]
            deadline = expiry_sec + 60
            while not poc.get("is_sold"):
                upd = await asyncio.wait_for(queue.get(), deadline)
                poc = upd.get("proposal_open_contract", poc)
        finally:
            self._subs.pop(sub_id, None)
            await self._ws.send(json.dumps({"forget": sub_id}))
        profit = float(poc.get("profit", 0.0))
        outcome = "win" if profit > 0 else "loss" if profit < 0 else "tie"
        return TradeResult(outcome, profit, ref)
