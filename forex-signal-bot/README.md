# Forex Signal Bot (30m trend + 5m entry)

Ekta professional-style forex signal bot. Kono npm package lage na, shudhu **Node.js 22.18 ba tar beshi** lagbe.

> ⚠️ **Kono bot 90% accuracy guarantee dite pare na.** Ei bot paper trading kore (virtual taka), real order dey na.
> Real taka diye trade korar age `npm run backtest` ar kichu shoptaho `npm run live`-er paper result dekhun.
> Eta financial advice na.

## Features

| Feature | Ki kore |
|---|---|
| **Multi-timeframe** | 30m candle theke trend (EMA20/50 + ADX), 5m candle theke entry |
| **2 ta setup** | Trend Pullback (EMA9/21 cross) ar Breakout (2 ghontar high/low bhanga) |
| **Strength Score 0–100** | Trend, trigger, ADX, RSI, session, 30m momentum ar volatility mile score dey. Eta *quality*, win probability na |
| **News filter** | ForexFactory calendar dekhe high-impact news-er ±30 min age-pore signal block kore |
| **Session filter** | Shudhu London / New York session-e trade (Asia session baad) |
| **Smart exits** | TP1 (1R)-e 50% close + SL breakeven-e, baki ta TP2 (2R) porjonto |
| **Lot size calculator** | Balance ar risk % (default 1%) theke lot size hisab kore, cross pair-o (EURJPY) |
| **Portfolio risk** | Ek shathe max 3 trade, ek currency-te max 2 trade, din-e −3R loss hole oi din-er jonno bondho |
| **Paper trading** | Virtual $10,000 account-e auto trade, balance ar P&L track kore |
| **Web dashboard** | `http://localhost:3100`: balance, equity chart, live signal, open/closed trade, backtest, news, Pause/Resume |
| **Voice + sound alert** | Signal ashle dashboard-e beep baje, voice-e **"Buy signal, E U R U S D, entry..."** bole (English ba Bangla), notification ar screen-e popup dekhay |
| **Mobile** | `npm run live:mobile` dile same Wi-Fi-te phone theke dashboard khola jay; "Add to Home Screen" kore app-er moto use kora jay |
| **Telegram** | Signal alert, trade close alert, ar `/status` `/stats` `/open` `/pause` `/resume` command |
| **Backtest** | Portfolio backtest, spread shoho; in-sample (70%) / out-of-sample (30%) alada, setup/score/pair onujayi |
| **Optimizer** | 108 ta setting combination test kore, ar overfitting dhorar jonno out-of-sample result-o dekhay |
| **No repainting** | Shudhu close howa candle use kore; test eta check kore |

Pair: EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, EURJPY, XAUUSD (gold-er jonno COMEX futures proxy).
Data: Yahoo Finance (free, kono API key lage na; 5m data shorbochcho ~60 din).

## Commands

```bash
cd forex-signal-bot
npm run demo       # internet chhara dashboard dekhun (synthetic data)
npm run backtest   # ~60 diner real data-y test; result dashboard-e-o dekhabe
npm run optimize   # bhalo setting khoje, out-of-sample diye check kore
npm run live       # live bot + dashboard (http://localhost:3100)
npm run live:mobile # same, kintu phone theke-o khola jay (same Wi-Fi)
npm run once       # ekbar scan (cron-er jonno)
npm test
```

### Voice alert (dashboard)

1. Dashboard khulun, upore **🔕 Enable alerts** button-e ekbar click korun (browser-er niyom: shobdo bajate ekbar click lagbe).
2. Pashe **English voice / Bangla voice** bechhe nin. Bangla voice phone/computer-e install thakle Bangla-y bolbe, na thakle English-e.
3. Tab ta khola rakhun. Signal ashle beep bajbe, voice-e Buy/Sell bolbe, ar popup dekhabe.

Phone-e browser tab bondho ba screen lock hole voice alert bajbe na. Phone-er jonno **Telegram** shobcheye bhalo: screen lock thakleo notification ashe.

### Mobile theke dashboard

Computer-e bot chalan:

```bash
npm run live:mobile
```

Terminal-e `http://192.168.x.x:3100`-er moto ekta link dekhabe. Phone same Wi-Fi-te rekhe oi link khulun, tarpor browser menu theke **Add to Home Screen** korun.
Lokkho korun: `--lan` mode-e same Wi-Fi-r je keu dashboard dekhte ar bot pause korte parbe. Bahire theke (mobile data) dekhte chaile Telegram use korun.

### Telegram setup

1. Telegram-e **@BotFather** → `/newbot` → token copy korun.
2. Notun bot-ke ekta message pathan, tarpor `https://api.telegram.org/bot<TOKEN>/getUpdates` khule `chat.id` nin.
3. Chalan:

```bash
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy npm run live
```

Bot shudhu apnar chat ID theke asha command-er uttor dey.

## Settings

Shob setting `src/config.ts`-e ache: pair, spread, EMA/RSI/ADX period, SL/TP, min score, risk %, max trade,
daily loss limit, news window. `npm run optimize` je setting out-of-sample-e-o positive dekhay, shegulo boshan.

## Result kivabe porben

- **Win %** ekhane mane je trade gulo R > 0-te shesh hoyeche. TP1-er por breakeven-e bondho howa trade-o er moddhe dhora hoy.
  Tai win % beshi holeo lav na-o hote pare. **Demo-tei dekhun: 59% win, kintu PF 0.80, mane loss.**
- **avg R ar PF (profit factor)** asol jinish. PF > 1 mane spread-er porew lav.
- **Out-of-sample** result-ke beshi bishshash korun. In-sample bhalo kintu out-of-sample kharap hole bujhben overfit.
- **Score** column dekhun: high-score trade jodi low-score-er cheye bhalo na kore, tahole score filter kono kaj korche na.

## Files

```
src/config.ts     settings          src/strategy.ts   setup + score
src/indicators.ts EMA/RSI/ATR/ADX   src/simulate.ts   TP1/BE/TP2 trade management
src/risk.ts       lot size, rules   src/news.ts       news filter
src/paper.ts      paper account     src/telegram.ts   alerts + commands
src/dashboard.ts  web dashboard     src/live.ts       live bot
src/backtest.ts   backtest/report   src/optimize.ts   optimizer
```

Paper account ar backtest result `data/` folder-e save hoy (git-e jay na). Notun kore shuru korte `data/paper.json` delete korun.
