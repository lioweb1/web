"""Risk manager: stake sizing and hard stops. No martingale, ever."""

from __future__ import annotations

import time as _time
from dataclasses import dataclass, field


@dataclass
class RiskConfig:
    stake_pct: float = 1.0          # % of balance per trade
    min_stake: float = 1.0
    max_stake: float = 100.0
    max_daily_loss_pct: float = 5.0  # stop for the day after losing this % of start balance
    max_daily_trades: int = 30
    max_consecutive_losses: int = 3
    cooldown_after_loss_sec: int = 180
    min_confidence: float = 0.6
    trade_hours_utc: list[int] | None = None  # e.g. [7..20]; None = always
    daily_profit_target_pct: float | None = None  # stop for the day once reached
    max_concurrent_trades: int = 1        # open positions across all symbols
    max_signals_per_close: int = 1        # new trades per candle close

    @classmethod
    def from_dict(cls, d: dict) -> "RiskConfig":
        hours = d.get("trade_hours_utc")
        if isinstance(hours, dict):  # {"start": 7, "end": 20}
            hours = list(range(int(hours["start"]), int(hours["end"]) + 1))
        known = {k: v for k, v in d.items() if k in cls.__dataclass_fields__ and k != "trade_hours_utc"}
        return cls(trade_hours_utc=hours, **known)


@dataclass
class RiskState:
    day: str = ""
    start_balance: float = 0.0
    realised_pnl: float = 0.0
    trades_today: int = 0
    consecutive_losses: int = 0
    last_loss_at: float = 0.0
    wins: int = 0
    losses: int = 0
    halted_reason: str = ""
    history: list[dict] = field(default_factory=list)


class RiskManager:
    def __init__(self, cfg: RiskConfig, now=None):
        self.cfg = cfg
        self.state = RiskState()
        self._now = now or _time.time

    # ---- lifecycle -------------------------------------------------------
    def _roll_day(self, balance: float) -> None:
        day = _time.strftime("%Y-%m-%d", _time.gmtime(self._now()))
        if self.state.day != day:
            self.state = RiskState(day=day, start_balance=balance)

    def stake_for(self, balance: float) -> float:
        stake = balance * self.cfg.stake_pct / 100.0
        return round(min(max(stake, self.cfg.min_stake), self.cfg.max_stake), 2)

    # ---- gate --------------------------------------------------------------
    def can_trade(self, balance: float, confidence: float) -> tuple[bool, str]:
        self._roll_day(balance)
        s, c = self.state, self.cfg
        if s.halted_reason:
            return False, s.halted_reason
        if confidence < c.min_confidence:
            return False, f"confidence {confidence:.2f} < {c.min_confidence}"
        if c.trade_hours_utc is not None:
            hour = _time.gmtime(self._now()).tm_hour
            if hour not in c.trade_hours_utc:
                return False, f"outside trade hours (utc {hour})"
        if s.trades_today >= c.max_daily_trades:
            s.halted_reason = "daily trade cap reached"
            return False, s.halted_reason
        if s.start_balance and -s.realised_pnl >= s.start_balance * c.max_daily_loss_pct / 100.0:
            s.halted_reason = "daily loss limit hit"
            return False, s.halted_reason
        if (
            c.daily_profit_target_pct is not None
            and s.start_balance
            and s.realised_pnl >= s.start_balance * c.daily_profit_target_pct / 100.0
        ):
            s.halted_reason = "daily profit target reached"
            return False, s.halted_reason
        if s.consecutive_losses >= c.max_consecutive_losses:
            s.halted_reason = f"{s.consecutive_losses} consecutive losses"
            return False, s.halted_reason
        if s.last_loss_at and self._now() - s.last_loss_at < c.cooldown_after_loss_sec:
            left = int(c.cooldown_after_loss_sec - (self._now() - s.last_loss_at))
            return False, f"cooldown {left}s"
        if balance < self.cfg.min_stake:
            return False, "balance below minimum stake"
        return True, "ok"

    # ---- result ---------------------------------------------------------
    def record(self, pnl: float, meta: dict | None = None) -> None:
        s = self.state
        s.trades_today += 1
        s.realised_pnl += pnl
        if pnl > 0:
            s.wins += 1
            s.consecutive_losses = 0
        elif pnl < 0:
            s.losses += 1
            s.consecutive_losses += 1
            s.last_loss_at = self._now()
        s.history.append({"pnl": pnl, "at": self._now(), **(meta or {})})

    def summary(self) -> dict:
        s = self.state
        total = s.wins + s.losses
        return {
            "day": s.day,
            "trades": s.trades_today,
            "wins": s.wins,
            "losses": s.losses,
            "win_rate": round(100.0 * s.wins / total, 1) if total else 0.0,
            "pnl": round(s.realised_pnl, 2),
            "halted": s.halted_reason or None,
        }
