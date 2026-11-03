"""Generic browser-automation adapter (Playwright).

Used for brokers without an official API (Pocket Option, Quotex, IQ Option,
Olymp Trade...). The bot drives the broker's own web page in a persistent
Chromium profile that *you* log into once. Credentials never pass through the
bot. Every broker is described by a YAML selector profile in ./profiles so a UI
change only needs a selector tweak, not a code change.

Result detection is balance-based: the balance is read before the trade and
again after expiry; the delta decides win/loss/tie. That works on every broker
without parsing their trade history widgets.

Note: most of these brokers forbid automation in their terms. Use demo accounts
to validate, and understand the ban risk before touching a real account.
"""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path

import yaml

from .base import BrokerAdapter, TradeResult

log = logging.getLogger(__name__)
PROFILES_DIR = Path(__file__).parent / "profiles"

_NUM = re.compile(r"-?\d[\d,]*\.?\d*")


def parse_money(text: str) -> float:
    m = _NUM.search(text.replace(" ", " "))
    if not m:
        raise ValueError(f"no number in {text!r}")
    return float(m.group(0).replace(",", ""))


class BrowserBroker(BrokerAdapter):
    name = "browser"

    def __init__(
        self,
        profile: str = "pocketoption",
        user_data_dir: str = "browser-profile",
        headless: bool = False,
        settle_grace_sec: int = 8,
        profile_overrides: dict | None = None,
    ):
        path = PROFILES_DIR / f"{profile}.yaml"
        self.cfg = yaml.safe_load(path.read_text())
        if profile_overrides:
            self.cfg.update(profile_overrides)
        self.name = f"browser:{profile}"
        self.user_data_dir = user_data_dir
        self.headless = headless
        self.settle_grace_sec = settle_grace_sec
        self._pw = None
        self._ctx = None
        self.page = None
        self._open: dict[str, dict] = {}

    # ---- lifecycle ----------------------------------------------------------------
    async def connect(self) -> None:
        from playwright.async_api import async_playwright

        self._pw = await async_playwright().start()
        self._ctx = await self._pw.chromium.launch_persistent_context(
            self.user_data_dir, headless=self.headless, viewport={"width": 1400, "height": 900}
        )
        self.page = self._ctx.pages[0] if self._ctx.pages else await self._ctx.new_page()
        await self.page.goto(self.cfg["trade_url"], wait_until="domcontentloaded")
        sel = self.cfg["selectors"]
        try:
            await self.page.wait_for_selector(sel["balance"], timeout=self.cfg.get("login_timeout_ms", 180_000))
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                f"{self.name}: balance element not found. Log in manually in the opened browser, "
                f"then restart. Selector tried: {sel['balance']}"
            ) from exc
        log.info("%s ready, balance %.2f", self.name, await self.balance())

    async def close(self) -> None:
        if self._ctx:
            await self._ctx.close()
        if self._pw:
            await self._pw.stop()

    # ---- helpers -----------------------------------------------------------------
    async def _text(self, selector: str) -> str:
        el = await self.page.wait_for_selector(selector, timeout=10_000)
        return (await el.inner_text()).strip()

    async def balance(self) -> float:
        return parse_money(await self._text(self.cfg["selectors"]["balance"]))

    async def _set_amount(self, stake: float) -> None:
        sel = self.cfg["selectors"]["amount_input"]
        inp = await self.page.wait_for_selector(sel, timeout=10_000)
        await inp.click(click_count=3)
        await inp.fill(self.cfg.get("amount_format", "{:.2f}").format(stake))
        await inp.press("Tab")

    async def _set_expiry(self, expiry_sec: int) -> None:
        """Best-effort: profiles may define a JS hook or a selector per expiry."""
        hook = self.cfg.get("expiry_js")
        if hook:
            await self.page.evaluate(hook, expiry_sec)
            return
        per = (self.cfg.get("expiry_selectors") or {}).get(str(expiry_sec))
        if per:
            await self.page.click(per)

    # ---- trading -------------------------------------------------------------------
    async def place(self, symbol: str, direction: str, stake: float, expiry_sec: int) -> str:
        sel = self.cfg["selectors"]
        before = await self.balance()
        await self._set_amount(stake)
        await self._set_expiry(expiry_sec)
        await self.page.click(sel["call_button"] if direction == "CALL" else sel["put_button"])
        ref = f"{symbol}-{int(asyncio.get_running_loop().time() * 1000)}"
        self._open[ref] = {"before": before, "stake": stake, "opened": asyncio.get_running_loop().time()}
        return ref

    async def wait_result(self, ref: str, expiry_sec: int) -> TradeResult:
        t = self._open.pop(ref)
        loop = asyncio.get_running_loop()
        await asyncio.sleep(max(0.0, t["opened"] + expiry_sec + self.settle_grace_sec - loop.time()))
        after = None
        for _ in range(10):  # balance can lag a few seconds after expiry
            after = await self.balance()
            if abs(after - t["before"]) > 1e-9:
                break
            await asyncio.sleep(2)
        if after is None:
            return TradeResult("unknown", 0.0, ref)
        delta = round(after - t["before"], 2)
        if delta > 0:
            return TradeResult("win", delta, ref)
        if delta < 0:
            return TradeResult("loss", delta, ref)
        return TradeResult("tie", 0.0, ref)
