"""Telegram notifications via the plain Bot HTTP API (no extra dependency)."""

from __future__ import annotations

import logging

import requests

log = logging.getLogger(__name__)


class Notifier:
    def __init__(self, token: str | None = None, chat_id: str | None = None):
        self.token = token
        self.chat_id = chat_id

    @property
    def enabled(self) -> bool:
        return bool(self.token and self.chat_id)

    def send(self, text: str) -> None:
        log.info("NOTIFY %s", text.replace("\n", " | "))
        if not self.enabled:
            return
        try:
            requests.post(
                f"https://api.telegram.org/bot{self.token}/sendMessage",
                json={"chat_id": self.chat_id, "text": text, "parse_mode": "HTML"},
                timeout=10,
            )
        except requests.RequestException as exc:  # never let notify crash the loop
            log.warning("telegram send failed: %s", exc)

    def signal(self, broker: str, symbol: str, direction: str, confidence: float, reasons: list[str], expiry_min: int) -> None:
        arrow = "🟢 CALL" if direction == "CALL" else "🔴 PUT"
        self.send(
            f"<b>{arrow}</b> {symbol} · {expiry_min}m · {broker}\n"
            f"confidence {confidence:.0%}\n" + "\n".join(f"• {r}" for r in reasons)
        )

    def result(self, symbol: str, direction: str, outcome: str, pnl: float, summary: dict) -> None:
        icon = {"win": "✅", "loss": "❌"}.get(outcome, "➖")
        self.send(
            f"{icon} {outcome.upper()} {symbol} {direction} pnl {pnl:+.2f}\n"
            f"today: {summary['wins']}W/{summary['losses']}L ({summary['win_rate']}%) pnl {summary['pnl']:+.2f}"
            + (f"\n⛔ halted: {summary['halted']}" if summary.get("halted") else "")
        )
