# binarybot

Modular signal + auto-trade engine for short-expiry binary options.
One strategy core, pluggable brokers, hard risk limits, backtester, Telegram alerts.

```
bot/
├── main.py                      CLI: download | backtest | run
├── config.example.yaml          copy to config.yaml
├── binarybot/
│   ├── indicators.py            EMA, RSI, Bollinger, ATR, Stochastic, MACD (pure pandas)
│   ├── strategy.py              mean_reversion, trend_pullback  -> Signal(direction, confidence, reasons)
│   ├── risk.py                  stake %, daily loss cap, loss streak halt, cooldown, trade hours
│   ├── backtest.py              candle-by-candle replay with payout model
│   ├── runner.py                live loop: candle close -> signal -> risk -> place -> settle
│   ├── datasource.py            free candle feeds: Deriv (forex/synthetics), Binance (crypto)
│   ├── notify.py                Telegram
│   └── brokers/
│       ├── paper.py             simulated account, settles on the live feed
│       ├── deriv.py             official Deriv WebSocket API (demo + real)
│       ├── browser.py           Playwright automation for brokers without an API
│       └── profiles/*.yaml      selectors for pocketoption, quotex, iqoption, olymptrade
└── tests/
```

## Install

```bash
cd bot
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium        # only for broker.kind: browser
cp config.example.yaml config.yaml
```

## 1. Backtest first

```bash
python main.py backtest --symbol frxEURUSD --count 5000          # downloads 1m candles from Deriv (free, no account)
python main.py backtest --symbol R_100 --count 5000 --payout 0.9
python main.py download --symbol frxEURUSD --count 5000 --out data/eurusd.csv
python main.py backtest --csv data/eurusd.csv --out data/trades.csv
```

The report prints win rate against the breakeven rate for the payout
(85% payout needs 54.1% wins), net result in stakes, max drawdown and a per-hour
breakdown so you can restrict `risk.trade_hours_utc` to the hours that work.

Tune `strategy.*` in `config.yaml` and re-run. If the backtest does not beat
breakeven by a clear margin over thousands of trades, do not go live.

## 2. Paper / dry run

```bash
python main.py run --dry-run         # signals + Telegram only, no orders
python main.py run                   # broker.kind: paper -> simulated balance on the live feed
```

## 3. Deriv (official API, recommended first live broker)

1. Create an API token at https://app.deriv.com/account/api-token with the *Trade* scope.
2. Use a demo login (VRTC...) until the paper results hold.
3. `export DERIV_TOKEN=...` and set `broker.kind: deriv`.

Symbols: `frxEURUSD`, `frxGBPUSD`, `R_100`, `1HZ100V`, `cryBTCUSD`, ...

## 4. Browser brokers (Pocket Option, Quotex, IQ Option, Olymp Trade)

These brokers have no public API. `brokers/browser.py` drives their web page
in a persistent Chromium profile:

1. `broker.kind: browser`, `broker.browser.profile: pocketoption` (or quotex / iqoption / olymptrade).
2. First run opens Chromium. Log in manually, open the asset you configured in
   `symbol`, set the expiry in the UI to match `expiry_sec`. The bot waits for
   the balance element before trading.
3. Later runs reuse the profile folder (`browser-profile/`), so no re-login.

Candles come from the `data` feed (Deriv or Binance) for the same underlying;
results are detected from the balance change after expiry, which works on any
broker UI. Selectors live in `binarybot/brokers/profiles/*.yaml`; when a broker
redesigns its page you only update that file. **Verify every selector on a demo
account before using it for real.**

These brokers forbid automation in their terms of service and can close
accounts. That risk is yours.

## Risk rules (risk.* in config)

| key | meaning |
|---|---|
| `stake_pct` | % of current balance per trade, clamped to min/max_stake |
| `max_daily_loss_pct` | halt for the day after losing this % of the day's start balance |
| `max_consecutive_losses` | halt after N losses in a row |
| `cooldown_after_loss_sec` | wait after every loss |
| `max_daily_trades` | hard cap per day |
| `trade_hours_utc` | `{start, end}` or a list of hours |
| `daily_profit_target_pct` | stop for the day once reached |

There is no martingale and there never will be. Add it and the math turns
against you.

## Adding a strategy or a broker

* Strategy: write `def my_strategy(df, params) -> Signal` in `strategy.py`
  (the frame already has every indicator column) and register it in `STRATEGIES`.
  List several in `strategy.strategies` to require agreement.
* Broker: subclass `BrokerAdapter` (`balance`, `place`, `wait_result`) and
  register it in `brokers/__init__.py`.

## Telegram

Create a bot with @BotFather, get your chat id from @userinfobot, then set
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Every signal, result and halt is
posted. `--dry-run` turns the bot into a pure signal channel.

## Tests

```bash
python -m pytest -q tests
```
