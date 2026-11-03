# Apex Pulse 5M PRO (MetaTrader 4 & 5)

Apex Pulse 5M is a non-repainting CALL/PUT (BUY/SELL) indicator for 5-minute binary options and short-term forex trading. It comes with a dashboard and a win-rate tracker. On every closed candle it scores the next candle from 0 to 100 for each direction, and prints an arrow only when a high-confidence setup appears.

> **Risk warning.** No indicator can tell you for certain whether the next candle will close up or down. On M5, price moves are close to random. With an 85% payout you need to win **more than 54.1%** of trades just to break even. Use the built-in tracker and a demo account to check the real win rate on *your* pair and broker before you risk money.

## Files

| File | Platform | Purpose |
|------|----------|---------|
| `MT4/Indicators/ApexPulse5M.mq4` | MetaTrader 4 | Indicator source code |
| `MT5/Indicators/ApexPulse5M_MT5.mq5` | MetaTrader 5 | Indicator source code (same logic, same settings) |

Both versions share the same signal engine, filters, dashboard and inputs, so the signals are identical on the same broker data.

## Install

**MetaTrader 4**
1. In MT4: **File → Open Data Folder → MQL4 → Indicators**.
2. Copy `ApexPulse5M.mq4` into that folder.
3. Open MetaEditor (F4), open the file, and press **Compile** (F7). This creates `ApexPulse5M.ex4`.
4. In MT4, refresh the Navigator, then drag **Apex Pulse 5M** onto an **M5** chart.

**MetaTrader 5**
1. In MT5: **File → Open Data Folder → MQL5 → Indicators**.
2. Copy `ApexPulse5M_MT5.mq5` into that folder.
3. Open MetaEditor (F4), open the file, and press **Compile** (F7). This creates `ApexPulse5M_MT5.ex5`.
4. In MT5, refresh the Navigator, then drag **Apex Pulse 5M** onto an **M5** chart. The first load can take a few seconds while M15/H1 history downloads; the indicator waits for it so that history is calculated correctly.

For push alerts (both platforms), set up your MetaQuotes ID under **Tools → Options → Notifications**.

> To sell it or hand it out, give buyers only the compiled `.ex4` / `.ex5` file and keep the `.mq4` / `.mq5` source private.

## How the signal works

Each candle gets a confluence score per direction (100 points maximum):

| Component | Points | Logic |
|-----------|-------:|-------|
| Chart trend | 20 | Close vs EMA 50, EMA 21 vs EMA 50, EMA 21 slope |
| Higher-TF trend #1 (M15) | 15 | Last **closed** M15 candle vs its EMA 50 |
| Higher-TF trend #2 (H1) | 10 | Last **closed** H1 candle vs its EMA 50 |
| Stochastic trigger | 20 | %K crosses %D out of the 35/65 zone (end of the pullback) |
| RSI momentum | 10 | RSI rising and not overextended |
| MACD histogram (OsMA) | 10 | Momentum speeding up in the signal direction |
| Candle price action | 15 | Strong body that closes near its high/low, not an exhaustion candle |

An arrow is printed only when **all** of these are true:
- the Stochastic trigger fired;
- the score is at least `Minimum confluence score` (default 70);
- that direction scores higher than the opposite one;
- volatility is between 0.6× and 2.5× its baseline (this skips dead markets and news spikes);
- the session filter allows it, and no signal appeared during the cooldown bars.

Then three **stage-2 quality filters** must also pass (all use closed data only):
- **Support/resistance:** no CALL right under a recent swing high, no PUT right above a recent swing low (within 0.8 ATR, 40-bar lookback).
- **Exhaustion:** no signal after 4+ same-color candles or after a climax candle (body > 2.2 ATR).
- **Smart filter (adaptive):** if the last 20 resolved CALL (or PUT) trades on this chart won less than 50%, that direction is paused until it recovers. It only looks at trades that were already finished at the time, so history and live behave identically.

Signal grades: **70–79 GOOD · 80–89 STRONG · 90–100 PREMIUM**. Turn on **Premium-only mode** to get only 85+ signals (fewer, higher-quality trades).

### Why it doesn't repaint

- Signals are calculated **only on closed candles**. The forming candle never gets an arrow.
- Higher-timeframe trend uses the last **fully closed** M15/H1 candle, so history never uses data that wasn't available at the time.
- The indicator waits until higher-timeframe history has loaded before it calculates, so arrows don't change after you restart MT4.
- Once printed, an arrow is never moved or removed. You can check this in the Strategy Tester (visual mode): what you see live matches what you see in history.

The dashboard's **"Forming candle"** row is a live preview of the candle still open. It *is* marked unconfirmed and can change until that candle closes. Only arrows count as signals.

## How to trade a signal

1. An arrow on a closed candle is the forecast for the **next** candle.
2. The alert fires on the first tick of that next candle. Enter immediately.
3. Expiry = `Expiry in candles` × timeframe (default: 1 × 5 min).
4. ✔ / ✘ marks on the chart show how each past signal turned out.

## Dashboard

- Pair, timeframe and a countdown to candle close
- **Next candle signal**: CALL / PUT / WAIT with a 0–100 confidence meter and grade
- **Setup checklist**: the 7 confluence components with ✔ / ✘ for the last closed candle, e.g. *6 / 7 confirmed*
- **Smart filter** status (active, or which direction is paused) and a high-spread warning
- Live preview of the forming candle, plus filter status (low volatility, spike, outside session)
- Trend arrows for M5 / M15 / H1, RSI and Stochastic values, volatility ratio, current session
- **Performance**: win rate, W/L/D counts, break-even win rate for your payout, edge, CALL vs PUT win rate, today's results, win rate for the current hour of the day, streaks, last 10 results, and the last signal (with a running in-profit / in-loss status)

The win-rate tracker enters at the **open** of the candle after the signal and exits at the **close** of the expiry candle. That is how a binary trade actually settles. A close equal to the entry counts as a draw.

## Recommended use

- Charts: M5 major pairs (EURUSD, GBPUSD, USDJPY, AUDUSD), London and New York sessions.
- Set `Broker server time GMT offset` correctly (many brokers use GMT+2 or GMT+3) so the session filter is accurate.
- Set `Broker payout %` to your real payout so break-even and edge are calculated correctly.
- If the **Edge** row is red on a pair, don't trade that pair. Try raising `Minimum confluence score` to 80, or switching the session filter to *London + New York*.
- Don't use martingale. Risk a small, fixed amount per trade.

## Buffers (for EAs / iCustom)

| Index | Content |
|------:|---------|
| 0 | CALL arrow price (EMPTY_VALUE when none) |
| 1 | PUT arrow price |
| 2 | Win mark |
| 3 | Loss mark |
| 4 | CALL score 0–100 |
| 5 | PUT score 0–100 |

Read shift `1` (the last closed candle) for non-repainting values.
