from binarybot.risk import RiskConfig, RiskManager


class Clock:
    def __init__(self, t=1_700_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


def make(**kw):
    clock = Clock()
    cfg = RiskConfig(cooldown_after_loss_sec=0, trade_hours_utc=None, **kw)
    return RiskManager(cfg, now=clock), clock


def test_stake_is_percent_of_balance_within_bounds():
    rm, _ = make(stake_pct=2.0, min_stake=1, max_stake=10)
    assert rm.stake_for(100) == 2.0
    assert rm.stake_for(10) == 1.0
    assert rm.stake_for(10_000) == 10.0


def test_consecutive_losses_halt():
    rm, _ = make(max_consecutive_losses=2)
    assert rm.can_trade(100, 0.9)[0]
    rm.record(-1)
    rm.record(-1)
    ok, why = rm.can_trade(100, 0.9)
    assert not ok and "consecutive" in why


def test_win_resets_streak():
    rm, _ = make(max_consecutive_losses=2)
    rm.record(-1)
    rm.record(+0.85)
    rm.record(-1)
    assert rm.can_trade(100, 0.9)[0]


def test_daily_loss_limit():
    rm, _ = make(max_daily_loss_pct=5)
    rm.can_trade(100, 0.9)  # sets start balance
    rm.record(-3)
    assert rm.can_trade(97, 0.9)[0]
    rm.record(-2.5)
    ok, why = rm.can_trade(94.5, 0.9)
    assert not ok and "loss limit" in why


def test_low_confidence_rejected():
    rm, _ = make(min_confidence=0.7)
    ok, why = rm.can_trade(100, 0.5)
    assert not ok and "confidence" in why


def test_cooldown_then_allowed():
    clock = Clock()
    rm = RiskManager(RiskConfig(cooldown_after_loss_sec=120, trade_hours_utc=None, max_consecutive_losses=5), now=clock)
    rm.can_trade(100, 0.9)
    rm.record(-1)
    assert not rm.can_trade(99, 0.9)[0]
    clock.t += 121
    assert rm.can_trade(99, 0.9)[0]


def test_trade_hours_config_from_dict():
    cfg = RiskConfig.from_dict({"trade_hours_utc": {"start": 7, "end": 9}, "stake_pct": 3})
    assert cfg.trade_hours_utc == [7, 8, 9]
    assert cfg.stake_pct == 3


def test_summary():
    rm, _ = make()
    rm.can_trade(100, 0.9)
    rm.record(+0.85)
    rm.record(-1)
    s = rm.summary()
    assert s["wins"] == 1 and s["losses"] == 1 and s["win_rate"] == 50.0
