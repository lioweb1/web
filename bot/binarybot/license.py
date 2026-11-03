"""License client for the dashboard's /api/bot endpoints.

validate() is called at start-up and then every `recheck_sec`; trades and
status are pushed with ingest(). Network failures never stop trading inside a
grace window, so a flaky connection does not kill a running session.
"""

from __future__ import annotations

import hashlib
import logging
import platform
import socket
import time
import uuid

import requests

from . import __version__

log = logging.getLogger(__name__)


def machine_id() -> str:
    raw = f"{uuid.getnode()}-{platform.node()}-{platform.machine()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


class LicenseClient:
    def __init__(self, server_url: str | None, key: str | None, recheck_sec: int = 3600, grace_sec: int = 86_400, broker: str = ""):
        self.server_url = (server_url or "").rstrip("/")
        self.key = key
        self.recheck_sec = recheck_sec
        self.grace_sec = grace_sec
        self.broker = broker
        self.machine = machine_id()
        self.info: dict = {}
        self.last_ok: float = 0.0
        self.last_check: float = 0.0

    @property
    def enabled(self) -> bool:
        return bool(self.server_url and self.key)

    @property
    def features(self) -> dict:
        return self.info.get("features") or {}

    # ---- validation ------------------------------------------------------------
    def validate(self) -> tuple[bool, str]:
        if not self.enabled:
            return True, "license check disabled"
        self.last_check = time.time()
        try:
            r = requests.post(
                f"{self.server_url}/api/bot/license/validate",
                json={"key": self.key, "machine_id": self.machine, "version": __version__, "hostname": socket.gethostname(), "broker": self.broker},
                timeout=15,
            )
            data = r.json()
        except (requests.RequestException, ValueError) as exc:
            if self.last_ok and time.time() - self.last_ok < self.grace_sec:
                return True, f"license server unreachable, grace period ({exc})"
            return False, f"license server unreachable: {exc}"
        if data.get("valid"):
            self.info = data
            self.last_ok = time.time()
            return True, f"license ok ({data.get('plan')}, expires {data.get('expires_at') or 'never'})"
        return False, f"license invalid: {data.get('reason', 'unknown')}"

    def due(self) -> bool:
        return self.enabled and time.time() - self.last_check >= self.recheck_sec

    # ---- telemetry ---------------------------------------------------------------
    def ingest(self, payload: dict) -> None:
        if not self.enabled:
            return
        try:
            requests.post(
                f"{self.server_url}/api/bot/ingest",
                json=payload,
                headers={"x-license-key": self.key, "x-machine-id": self.machine},
                timeout=15,
            )
        except requests.RequestException as exc:
            log.warning("ingest failed: %s", exc)

    def trade(self, row: dict) -> None:
        self.ingest({"type": "trade", "trade": row})

    def status(self, balance: float, summary: dict, config: dict) -> None:
        self.ingest({"type": "status", "status": {"balance": balance, "summary": summary, "config": config, "version": __version__, "broker": self.broker}})
