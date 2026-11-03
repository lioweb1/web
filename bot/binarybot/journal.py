"""Trade journal analytics over trades.log (one JSON object per line).

Also powers the runner's adaptive filter: symbols / hours whose recent
performance is below breakeven get skipped automatically.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

COLS = ["time", "symbol", "direction", "stake", "confidence", "outcome", "pnl", "strategy", "broker", "reasons", "htf"]


def load(path: str | Path) -> pd.DataFrame:
    p = Path(path)
    if not p.exists():
        return pd.DataFrame(columns=COLS)
    rows = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    df = pd.DataFrame(rows)
    for c in COLS:
        if c not in df.columns:
            df[c] = None
    df = df[df["outcome"].isin(["win", "loss", "tie"])].copy()
    df["dt"] = pd.to_datetime(df["time"], unit="s", utc=True)
    df["hour"] = df["dt"].dt.hour
    df["day"] = df["dt"].dt.date
    df["won"] = (df["outcome"] == "win").astype(int)
    df["decided"] = (df["outcome"] != "tie").astype(int)
    return df


def _agg(df: pd.DataFrame, by) -> pd.DataFrame:
    g = df.groupby(by)
    out = pd.DataFrame({
        "n": g.size(),
        "wins": g["won"].sum(),
        "pnl": g["pnl"].sum().round(2),
    })
    decided = g["decided"].sum()
    out["win_rate"] = (100.0 * out["wins"] / decided.replace(0, 1)).round(1)
    out["avg_conf"] = g["confidence"].mean().round(2)
    return out.sort_values("pnl", ascending=False)


def report(df: pd.DataFrame, payout: float = 0.85) -> dict[str, pd.DataFrame | dict]:
    if df.empty:
        return {"summary": {"trades": 0}}
    decided = df[df["decided"] == 1]
    equity = df["pnl"].cumsum()
    summary = {
        "trades": int(len(df)),
        "wins": int(df["won"].sum()),
        "losses": int((df["outcome"] == "loss").sum()),
        "ties": int((df["outcome"] == "tie").sum()),
        "win_rate": round(100.0 * df["won"].sum() / max(len(decided), 1), 1),
        "breakeven_win_rate": round(100.0 / (1.0 + payout), 1),
        "pnl": round(float(df["pnl"].sum()), 2),
        "max_drawdown": round(float((equity.cummax() - equity).max()), 2),
        "avg_stake": round(float(df["stake"].mean()), 2),
        "first": str(df["dt"].min()),
        "last": str(df["dt"].max()),
        "best_day": None,
        "worst_day": None,
    }
    by_day = df.groupby("day")["pnl"].sum()
    if len(by_day):
        summary["best_day"] = f"{by_day.idxmax()} {by_day.max():+.2f}"
        summary["worst_day"] = f"{by_day.idxmin()} {by_day.min():+.2f}"
    return {
        "summary": summary,
        "by_symbol": _agg(df, "symbol"),
        "by_hour": _agg(df, "hour").sort_index(),
        "by_direction": _agg(df, "direction"),
        "by_strategy": _agg(df.fillna({"strategy": "?"}), "strategy"),
        "by_confidence": _agg(df.assign(conf_bin=(df["confidence"] * 5).round() / 5), "conf_bin").sort_index(),
        "by_day": by_day.round(2).to_frame("pnl"),
        "streaks": _streaks(df),
    }


def _streaks(df: pd.DataFrame) -> dict:
    best = worst = cur = 0
    last = None
    for o in df["outcome"]:
        if o == "tie":
            continue
        if o == last:
            cur += 1
        else:
            cur, last = 1, o
        if o == "win":
            best = max(best, cur)
        else:
            worst = max(worst, cur)
    return {"longest_win_streak": best, "longest_loss_streak": worst}


def format_report(rep: dict) -> str:
    if rep["summary"].get("trades", 0) == 0:
        return "journal is empty"
    lines = ["== summary =="]
    lines += [f"{k:<20}: {v}" for k, v in rep["summary"].items()]
    lines += [f"{k:<20}: {v}" for k, v in rep["streaks"].items()]
    for name in ("by_symbol", "by_hour", "by_direction", "by_strategy", "by_confidence"):
        lines.append(f"\n== {name} ==")
        lines.append(rep[name].to_string())
    return "\n".join(lines)


class AdaptiveFilter:
    """Skip symbols / hours with poor recent results.

    A bucket is blocked when it has at least `min_trades` recent trades and its
    win rate is below `breakeven - margin`. Re-evaluated every call.
    """

    def __init__(self, path: str | None, payout: float = 0.85, lookback_trades: int = 200, min_trades: int = 15, margin_pct: float = 3.0, enabled: bool = True):
        self.path = path
        self.enabled = enabled and bool(path)
        self.payout = payout
        self.lookback = lookback_trades
        self.min_trades = min_trades
        self.threshold = 100.0 / (1.0 + payout) - margin_pct
        self._cache: tuple[float, set, set] = (0.0, set(), set())

    def _refresh(self) -> None:
        import time

        if time.time() - self._cache[0] < 300:
            return
        df = load(self.path).tail(self.lookback)
        bad_sym, bad_hour = set(), set()
        if not df.empty:
            for key, row in _agg(df, "symbol").iterrows():
                if row["n"] >= self.min_trades and row["win_rate"] < self.threshold:
                    bad_sym.add(key)
            for key, row in _agg(df, "hour").iterrows():
                if row["n"] >= self.min_trades and row["win_rate"] < self.threshold:
                    bad_hour.add(int(key))
        self._cache = (time.time(), bad_sym, bad_hour)

    def check(self, symbol: str, hour_utc: int) -> tuple[bool, str]:
        if not self.enabled:
            return True, "ok"
        self._refresh()
        _, bad_sym, bad_hour = self._cache
        if symbol in bad_sym:
            return False, f"journal: {symbol} below breakeven recently"
        if hour_utc in bad_hour:
            return False, f"journal: hour {hour_utc:02d} UTC below breakeven recently"
        return True, "ok"
