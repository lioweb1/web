#!/usr/bin/env python3
"""CLI entry point.

  python main.py backtest  --symbol frxEURUSD --count 5000 [--csv data/eurusd.csv]
  python main.py download  --symbol frxEURUSD --count 5000 --out data/eurusd.csv
  python main.py run       --config config.yaml [--dry-run]
  python main.py optimize  --symbol frxEURUSD --count 20000 [--samples 60 --folds 4]
  python main.py journal   [--log trades.log]
  python main.py copy      --config config.yaml      (Telegram signal copier)
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
from binarybot import journal as journalmod  # noqa: E402
from binarybot.optimize import format_results, walk_forward  # noqa: E402
from binarybot.runner import CopierRunner, Runner  # noqa: E402


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


def _symbols(args, cfg):
    if args.symbol:
        return [s.strip() for s in args.symbol.split(",") if s.strip()]
    return list(cfg.get("symbols") or [cfg["symbol"]])


def _load_candles(args, cfg, symbol):
    if args.csv:
        return pd.read_csv(args.csv)
    return asyncio.run(_download(cfg["data"], symbol, args.granularity or cfg["granularity"], args.count))


def cmd_backtest(args, cfg):
    gran = int(args.granularity or cfg["granularity"])
    expiry_candles = max(1, int(cfg["expiry_sec"]) // gran)
    sp = cfg["strategy"]
    htf = None if args.no_htf else int(sp.get("htf_granularity", 0) or 0) or None
    for symbol in _symbols(args, cfg):
        df = _load_candles(args, cfg, symbol)
        res = run_backtest(df, sp, expiry_candles=expiry_candles, payout=args.payout,
                           min_confidence=sp.get("min_confidence", 0.6), granularity=gran, htf_granularity=htf)
        print(f"\n### {symbol}  candles {len(df)}  expiry {expiry_candles} candle(s)  payout {args.payout:.0%}  htf {htf or 'off'}")
        print(res)
        if args.out and not res.trades.empty:
            out = args.out if len(_symbols(args, cfg)) == 1 else args.out.replace(".csv", f"_{symbol}.csv")
            res.trades.to_csv(out, index=False)
            print(f"trades -> {out}")


def cmd_optimize(args, cfg):
    gran = int(args.granularity or cfg["granularity"])
    expiry_candles = max(1, int(cfg["expiry_sec"]) // gran)
    sp = cfg["strategy"]
    htf = int(sp.get("htf_granularity", 300) or 300)
    space = None
    if args.space:
        import yaml

        space = yaml.safe_load(Path(args.space).read_text())
    for symbol in _symbols(args, cfg):
        df = _load_candles(args, cfg, symbol)
        print(f"\n### optimizing {symbol} on {len(df)} candles, {args.folds} folds, {args.samples or 'all'} samples")

        def prog(i, n, c):
            if i % 10 == 0 or i == n:
                print(f"  {i}/{n}  last: oos n={c.oos_trades} wr={c.oos_win_rate:.1f}% net={c.oos_net:+.2f}", flush=True)

        ranked = walk_forward(df, sp, space=space, n_samples=args.samples, folds=args.folds, expiry_candles=expiry_candles,
                              payout=args.payout, granularity=gran, htf_granularity=htf, progress=prog)
        print(format_results(ranked, args.payout, top=args.top))
        if args.out and ranked:
            import yaml

            Path(args.out).write_text(yaml.safe_dump({"strategy": {**sp, **ranked[0].params}}, sort_keys=False))
            print(f"best params -> {args.out} (merge into config.yaml)")


def cmd_journal(args, cfg):
    df = journalmod.load(args.log or cfg.get("log_file", "trades.log"))
    if args.symbol:
        df = df[df["symbol"].isin(_symbols(args, cfg))]
    if args.days:
        cutoff = pd.Timestamp.utcnow() - pd.Timedelta(days=args.days)
        df = df[df["dt"] >= cutoff]
    rep = journalmod.report(df, payout=args.payout)
    print(journalmod.format_report(rep))
    if args.out and rep["summary"].get("trades"):
        df.to_csv(args.out, index=False)
        print(f"trades -> {args.out}")


def cmd_copy(args, cfg):
    if not cfg.get("copier", {}).get("api_id"):
        raise SystemExit("config.yaml needs a copier: section (api_id, api_hash, channels)")
    runner = CopierRunner(cfg, dry_run=args.dry_run)
    loop = asyncio.new_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, runner.stop)
    loop.run_until_complete(runner.run())


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
    b.add_argument("--symbol", help="one symbol or a comma-separated list")
    b.add_argument("--granularity", type=int)
    b.add_argument("--count", type=int, default=5000)
    b.add_argument("--csv", help="use a saved CSV instead of downloading")
    b.add_argument("--payout", type=float, default=0.85)
    b.add_argument("--no-htf", action="store_true", help="disable the multi-timeframe filter")
    b.add_argument("--out", help="write trade list CSV")
    b.set_defaults(fn=cmd_backtest)

    o = sub.add_parser("optimize", help="walk-forward parameter search")
    o.add_argument("--symbol")
    o.add_argument("--granularity", type=int)
    o.add_argument("--count", type=int, default=20000)
    o.add_argument("--csv")
    o.add_argument("--payout", type=float, default=0.85)
    o.add_argument("--samples", type=int, default=60, help="random combinations to try (0 = full grid)")
    o.add_argument("--folds", type=int, default=4)
    o.add_argument("--top", type=int, default=10)
    o.add_argument("--space", help="YAML file with {param: [values]} to override the search space")
    o.add_argument("--out", help="write best params as YAML")
    o.set_defaults(fn=cmd_optimize)

    j = sub.add_parser("journal", help="analytics over trades.log")
    j.add_argument("--log")
    j.add_argument("--symbol")
    j.add_argument("--days", type=int)
    j.add_argument("--payout", type=float, default=0.85)
    j.add_argument("--out", help="write filtered trades CSV")
    j.set_defaults(fn=cmd_journal)

    c = sub.add_parser("copy", help="execute signals copied from Telegram channels")
    c.add_argument("--dry-run", action="store_true")
    c.set_defaults(fn=cmd_copy)

    r = sub.add_parser("run", help="live loop")
    r.add_argument("--dry-run", action="store_true", help="signals + notifications only, no orders")
    r.set_defaults(fn=cmd_run)

    args = p.parse_args(argv)
    if getattr(args, "samples", None) == 0:
        args.samples = None
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = cfgmod.load(args.config)
    args.fn(args, cfg)


if __name__ == "__main__":
    main()
