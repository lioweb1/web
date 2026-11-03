"""YAML config loading with environment-variable expansion (${VAR})."""

from __future__ import annotations

import os
import re
from pathlib import Path

import yaml

_ENV = re.compile(r"\$\{([A-Z0-9_]+)\}")

DEFAULTS: dict = {
    "symbol": "frxEURUSD",
    "granularity": 60,          # candle size in seconds
    "expiry_sec": 60,           # contract length
    "history": 300,             # candles to keep for indicators
    "strategy": {"strategies": ["mean_reversion"], "min_confidence": 0.6},
    "risk": {},
    "broker": {"kind": "paper"},
    "data": {"kind": "deriv"},
    "telegram": {},
    "log_file": "trades.log",
}


def _expand(obj):
    if isinstance(obj, str):
        return _ENV.sub(lambda m: os.environ.get(m.group(1), ""), obj)
    if isinstance(obj, dict):
        return {k: _expand(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_expand(v) for v in obj]
    return obj


def _merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in override.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load(path: str | Path | None) -> dict:
    cfg = DEFAULTS
    if path and Path(path).exists():
        cfg = _merge(cfg, yaml.safe_load(Path(path).read_text()) or {})
    return _expand(cfg)
