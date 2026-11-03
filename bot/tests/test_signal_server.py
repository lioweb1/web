import asyncio
import json

import pytest
import websockets

from binarybot.brokers.extension import ExtensionBroker
from binarybot.signal_server import SignalServer


@pytest.mark.asyncio
async def test_extension_roundtrip():
    server = SignalServer("127.0.0.1", 0)
    await server.start()
    port = server._server.sockets[0].getsockname()[1]
    broker = ExtensionBroker(server=server)

    async def fake_extension():
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            hello = json.loads(await ws.recv())
            assert hello["type"] == "hello"
            await ws.send(json.dumps({"type": "register", "broker": "test"}))
            await ws.send(json.dumps({"type": "balance", "balance": 250.0}))
            sig = json.loads(await ws.recv())
            assert sig["type"] == "signal" and sig["direction"] == "PUT"
            await ws.send(json.dumps({"type": "result", "id": sig["id"], "outcome": "win", "pnl": 4.2}))
            await asyncio.sleep(0.1)

    ext = asyncio.create_task(fake_extension())
    await asyncio.sleep(0.2)
    assert server.connected == 1
    assert await broker.balance() == 250.0
    ref = await broker.place("EURUSD", "PUT", 5.0, 60, confidence=0.9, reasons=["t"])
    res = await broker.wait_result(ref, 60)
    assert res.outcome == "win" and res.pnl == 4.2
    await ext
    await server.stop()


@pytest.mark.asyncio
async def test_place_without_client_raises():
    server = SignalServer("127.0.0.1", 0)
    await server.start()
    broker = ExtensionBroker(server=server)
    with pytest.raises(RuntimeError):
        await broker.place("EURUSD", "CALL", 1.0, 60)
    await server.stop()
