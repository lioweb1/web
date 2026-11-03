"""Telegram signal copier.

Reads messages from one or more Telegram channels/groups with a *user* account
(Telethon, MTProto) and turns them into trades through the same broker adapter
and risk manager as the bot's own signals. Message formats vary wildly, so the
parser is regex-driven and configurable.

Config:
  copier:
    api_id: ${TG_API_ID}          # my.telegram.org
    api_hash: ${TG_API_HASH}
    session: copier.session
    channels: ["@somechannel", -1001234567890]
    default_expiry_sec: 60
    symbol_map: {"EUR/USD": "frxEURUSD", "EURUSD-OTC": "EURUSD_otc"}
    patterns:                      # optional extra regexes with named groups symbol/direction/expiry
      - "(?P<symbol>[A-Z]{3}/[A-Z]{3}(?:-OTC)?).*?(?P<direction>CALL|PUT|UP|DOWN|BUY|SELL).*?(?P<expiry>\\d+)\\s*(?:m|min)"
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass

log = logging.getLogger(__name__)

_UP = {"CALL", "UP", "BUY", "HIGHER", "LONG", "🟢", "⬆", "🔼", "⬆️", "📈"}
_DOWN = {"PUT", "DOWN", "SELL", "LOWER", "SHORT", "🔴", "⬇", "🔽", "⬇️", "📉"}

DEFAULT_PATTERNS = [
    # EUR/USD CALL 1M  |  EURUSD-OTC PUT 5 min  |  GBP/JPY 🟢 UP 1m
    r"(?P<symbol>[A-Z]{3}\s*/?\s*[A-Z]{3}(?:[\s-]*OTC)?)[^\n]*?(?P<direction>CALL|PUT|UP|DOWN|BUY|SELL|HIGHER|LOWER|🟢|🔴|⬆️?|⬇️?|🔼|🔽|📈|📉)[^\n]*?(?P<expiry>\d+)\s*(?:m|min|minute)",
    # direction first: CALL EUR/USD 1 min
    r"(?P<direction>CALL|PUT|UP|DOWN|BUY|SELL|🟢|🔴|⬆️?|⬇️?|🔼|🔽)[^\n]*?(?P<symbol>[A-Z]{3}\s*/?\s*[A-Z]{3}(?:[\s-]*OTC)?)[^\n]*?(?P<expiry>\d+)\s*(?:m|min|minute)",
    # no expiry in message
    r"(?P<symbol>[A-Z]{3}\s*/?\s*[A-Z]{3}(?:[\s-]*OTC)?)[^\n]*?(?P<direction>CALL|PUT|UP|DOWN|BUY|SELL|🟢|🔴|⬆️?|⬇️?|🔼|🔽)",
]


@dataclass
class CopiedSignal:
    symbol: str
    direction: str  # CALL | PUT
    expiry_sec: int
    raw: str


def normalise_symbol(s: str) -> str:
    s = s.upper().replace(" ", "")
    otc = "OTC" in s
    s = s.replace("-OTC", "").replace("OTC", "").replace("/", "")
    return f"{s}_otc" if otc else s


def parse(text: str, patterns: list[str] | None = None, default_expiry_sec: int = 60, symbol_map: dict | None = None) -> CopiedSignal | None:
    if not text:
        return None
    pats = (patterns or []) + DEFAULT_PATTERNS
    flat = text.replace("\n", " ")
    for pat in pats:
        m = re.search(pat, flat, re.IGNORECASE)
        if not m:
            continue
        d = m.group("direction").upper().strip()
        direction = "CALL" if d in _UP else "PUT" if d in _DOWN else None
        if direction is None:
            continue
        raw_sym = m.group("symbol").strip()
        sym = (symbol_map or {}).get(raw_sym) or (symbol_map or {}).get(raw_sym.upper()) or normalise_symbol(raw_sym)
        expiry = int(m.group("expiry")) * 60 if "expiry" in m.groupdict() and m.group("expiry") else default_expiry_sec
        return CopiedSignal(sym, direction, expiry, text)
    return None


class Copier:
    """Listens to Telegram and hands trades to a callback: await on_signal(CopiedSignal)."""

    def __init__(self, cfg: dict, on_signal):
        self.cfg = cfg
        self.on_signal = on_signal
        self._client = None

    async def run(self) -> None:
        try:
            from telethon import TelegramClient, events
        except ImportError as exc:  # pragma: no cover
            raise SystemExit("pip install telethon   (needed for the copier)") from exc
        c = self.cfg
        self._client = TelegramClient(c.get("session", "copier.session"), int(c["api_id"]), c["api_hash"])
        await self._client.start()
        channels = c.get("channels") or []
        log.info("copier listening on %s", channels)

        @self._client.on(events.NewMessage(chats=channels or None))
        async def _handler(event):
            sig = parse(event.raw_text, c.get("patterns"), int(c.get("default_expiry_sec", 60)), c.get("symbol_map"))
            if not sig:
                log.debug("no signal in: %s", event.raw_text[:80])
                return
            log.info("copied signal %s %s %ss from %s", sig.symbol, sig.direction, sig.expiry_sec, event.chat_id)
            try:
                await self.on_signal(sig)
            except Exception as exc:  # noqa: BLE001
                log.exception("copier trade failed: %s", exc)

        await self._client.run_until_disconnected()

    async def stop(self) -> None:
        if self._client:
            await self._client.disconnect()
