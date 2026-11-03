#!/usr/bin/env python3
"""CLI entry point.

  python main.py backtest  --symbol frxEURUSD --count 5000 [--csv data/eurusd.csv]
  python main.py download  --symbol frxEURUSD --count 5000 --out data/eurusd.csv
  python main.py run       --config config.yaml [--dry-run]
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))

from binarybot import config as cfgmod  # noqa: E402
from binarybot.backtest import run_backtest  # noqa: E402
from binarybot.datasource import make_feed  # noqa: E402
from binarybot.runner import Runner  # noqa: E402


async def _download(feed_cfg: dict, symbol: str, granularity: int, count: int) -> pd.DataFrame:
    feed = make_feed(feed_cfg)
    await feed.connect()
    try:
        return await feed.candles(symbol, granularity, count)
    finally:
        await feed.close()


def cmd_download(args, cfg):
    df = asyncio.run(_download(cfg["data"], args.symbol or cfg["symbol"], args.granularity or cfg["granularity"], args.count))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"saved {len(df)} candles -> {args.out}")


def cmd_backtest(args, cfg):
    if args.csv:
        df = pd.read_csv(args.csv)
    else:
        df = asyncio.run(_download(cfg["data"], args.symbol or cfg["symbol"], args.granularity or cfg["granularity"], args.count))
    gran = args.granularity or cfg["granularity"]
    expiry_candles = max(1, int(cfg["expiry_sec"]) // int(gran))
    res = run_backtest(df, cfg["strategy"], expiry_candles=expiry_candles, payout=args.payout,
                       min_confidence=cfg["strategy"].get("min_confidence", 0.6))
    print(f"symbol {args.symbol or cfg['symbol']}  candles {len(df)}  expiry {expiry_candles} candle(s)  payout {args.payout:.0%}")
    print(res)
    if args.out and not res.trades.empty:
        res.trades.to_csv(args.out, index=False)
        print(f"trades -> {args.out}")


def cmd_run(args, cfg):
    runner = Runner(cfg, dry_run=args.dry_run)
    loop = asyncio.new_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, runner.stop)
    loop.run_until_complete(runner.run())


def main(argv=None):
    p = argparse.ArgumentParser(prog="binarybot")
    p.add_argument("--config", default="config.yaml")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("download", help="save candles to CSV")
    d.add_argument("--symbol")
    d.add_argument("--granularity", type=int)
    d.add_argument("--count", type=int, default=5000)
    d.add_argument("--out", default="data/candles.csv")
    d.set_defaults(fn=cmd_download)

    b = sub.add_parser("backtest", help="replay the strategy over history")
    b.add_argument("--symbol")
    b.add_argument("--granularity", type=int)
    b.add_argument("--count", type=int, default=5000)
    b.add_argument("--csv", help="use a saved CSV instead of downloading")
    b.add_argument("--payout", type=float, default=0.85)
    b.add_argument("--out", help="write trade list CSV")
    b.set_defaults(fn=cmd_backtest)

    r = sub.add_parser("run", help="live loop")
    r.add_argument("--dry-run", action="store_true", help="signals + notifications only, no orders")
    r.set_defaults(fn=cmd_run)

    args = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = cfgmod.load(args.config)
    args.fn(args, cfg)


if __name__ == "__main__":
    main()
