"""Broker adapters. Each adapter implements BrokerAdapter from base.py."""

from .base import BrokerAdapter, TradeResult


def make_broker(cfg: dict) -> BrokerAdapter:
    kind = cfg.get("kind", "paper")
    if kind == "paper":
        from .paper import PaperBroker

        return PaperBroker(**cfg.get("paper", {}))
    if kind == "deriv":
        from .deriv import DerivBroker

        return DerivBroker(**cfg.get("deriv", {}))
    if kind == "browser":
        from .browser import BrowserBroker

        return BrowserBroker(**cfg.get("browser", {}))
    if kind == "extension":
        from .extension import ExtensionBroker

        return ExtensionBroker(**cfg.get("extension", {}))
    raise ValueError(f"unknown broker kind: {kind}")


__all__ = ["BrokerAdapter", "TradeResult", "make_broker"]
