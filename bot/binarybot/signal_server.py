"""Local WebSocket server that broadcasts signals to the Chrome extension
(or any other client) and collects their trade results.

Protocol (JSON text frames)
  server -> client : hello | signal | status | halt | ping
  client -> server : register | pong | trade_placed | result | skipped | balance
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

import websockets

from . import __version__

log = logging.getLogger(__name__)


class SignalServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 8765, hello: dict | None = None):
        self.host, self.port = host, port
        self.hello_extra = hello or {}
        self.clients: dict = {}            # websocket -> register payload
        self.results: dict[str, asyncio.Future] = {}
        self.last_balance: float | None = None
        self._server = None

    # ---- lifecycle ----------------------------------------------------------
    async def start(self) -> None:
        self._server = await websockets.serve(self._handle, self.host, self.port, ping_interval=None)
        log.info("signal server listening on ws://%s:%d", self.host, self.port)

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    @property
    def connected(self) -> int:
        return len(self.clients)

    # ---- outbound -------------------------------------------------------------
    async def broadcast(self, msg: dict) -> int:
        data = json.dumps(msg)
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send(data)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.clients.pop(ws, None)
        return len(self.clients)

    async def send_signal(self, sig_id: str, symbol: str, direction: str, confidence: float, expiry_sec: int, stake: float, reasons: list[str]) -> asyncio.Future:
        fut = asyncio.get_running_loop().create_future()
        self.results[sig_id] = fut
        await self.broadcast({
            "type": "signal", "id": sig_id, "symbol": symbol, "direction": direction,
            "confidence": confidence, "expiry_sec": expiry_sec, "stake": stake,
            "reasons": reasons, "time": int(time.time()),
        })
        return fut

    # ---- inbound ----------------------------------------------------------------
    async def _handle(self, ws) -> None:
        self.clients[ws] = {}
        await ws.send(json.dumps({"type": "hello", "version": __version__, **self.hello_extra}))
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                self._on_message(ws, msg)
        except websockets.ConnectionClosed:
            pass
        finally:
            self.clients.pop(ws, None)

    def _on_message(self, ws, msg: dict) -> None:
        t = msg.get("type")
        if t == "register":
            self.clients[ws] = msg
            log.info("client registered: %s %s", msg.get("broker"), msg.get("extVersion"))
        elif t == "balance":
            self.last_balance = float(msg.get("balance", 0))
        elif t in ("result", "skipped"):
            fut = self.results.pop(msg.get("id", ""), None)
            if fut and not fut.done():
                fut.set_result(msg)
        elif t == "trade_placed":
            log.info("extension placed trade %s stake=%s", msg.get("id"), msg.get("stake"))
