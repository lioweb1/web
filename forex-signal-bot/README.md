# Forex Signal Bot (5m + 30m)

Forex pair-gulo auto scan kore signal dey. **30 minute** candle theke trend dekhe, ar **5 minute** candle theke entry khoje.
Prottek signal-e Entry, Stop Loss ar Take Profit thake. Kono npm package lage na, shudhu Node.js lagbe.

> ⚠️ **90% accuracy keu guarantee dite pare na.** Ei bot shei daabi kore na. Real taka diye trade korar age
> `npm run backtest` ar kichu shoptaho `npm run review` chalan. Eta financial advice na.

## Kivabe signal ashe

| Step | Timeframe | Rule |
|------|-----------|------|
| 1. Trend | 30m | Price EMA50-er upore ar EMA20 > EMA50 hole **UP**; ulta hole **DOWN** |
| 2. Trigger | 5m | EMA9, EMA21 ke trend-er dike cross kore |
| 3. Filter | 5m | Price 5m EMA50-er shothik pashe; RSI(14) BUY-er jonno 50–70, SELL-er jonno 30–50 |
| 4. Risk | 5m | SL = 1.5 × ATR(14), TP = 2.25 × ATR(14) → 1.5R target |

Tinta shorto ek shathe mille tobei signal ashe. Signal ashe shudhu **close howa** candle theke,
tai repaint kore na (`test/strategy.check.ts` eta check kore). Shob setting `src/config.ts`-e ache.

Default pair: EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD. Data ashe Yahoo Finance theke (free, kono API key lage na).

## Chalanor niyom (Node.js 22.18 ba tar beshi)

```bash
cd forex-signal-bot
npm run backtest   # gotho ~60 diner 5m data-te rules test kore, spread shoho
npm run live       # protiti 5m candle close howar por scan kore, signal print/Telegram kore
npm run once       # ekbar scan kore bondho hoy (cron-er jonno)
npm run review     # live signal gulo asole jitlo na harlo, tar hisab
npm test
```

### Telegram-e signal pete

1. Telegram-e **@BotFather** → `/newbot` → token copy korun.
2. Notun bot-ke ekta message pathan, tarpor `https://api.telegram.org/bot<TOKEN>/getUpdates` khule `chat.id` nin.
3. Chalan:

```bash
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy npm run live
```

## Result kivabe porben

- **Win %**: 1.5R target-e break-even korte ~40% win lagbe (spread-er karone ektu beshi).
- **avg R / PF**: asol jinish. PF > 1 mane spread-er porew lav. Win % beshi kintu PF < 1 hole loss.
- **maxDD**: shobcheye boro dhoshon, R-e. 1R = protiti trade-e apni joto taka risk koren.
- Shudhu 60 diner data, tai backtest result eta-ke proman na, ekta ingit hishebe dhorun.
