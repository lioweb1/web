# Signal Script: Binary & Forex Signals Website

A self-hosted PHP + MySQL website for publishing binary options, forex and crypto trading signals. It runs on Hostinger shared hosting, cPanel or any normal PHP host, with no Node.js and no build step.

## Features

| Area | What you get |
|---|---|
| **Auto signal engine** | Pulls real candles (Twelve Data for forex, Binance for crypto) and scores them with EMA 9/21/50, RSI 14, MACD 12/26/9 and ATR 14. Creates **CALL/PUT** binary signals with expiry, and **BUY/SELL** forex/crypto signals with SL, TP1 and TP2 from ATR. |
| **Automatic results** | Binary signals are marked WIN/LOSS at expiry. Forex/crypto signals close when TP or SL is hit. Win rates are published on the Results page. |
| **Free + premium** | Signals at or above the "premium confidence" are locked for free users (blurred card and an upsell). There's an optional delay for free users and premium-only blog posts. |
| **Premium payments** | Plans (weekly, monthly…), manual payments (USDT, bKash, Nagad, bank…). The user submits a transaction ID and you approve it in admin, which activates premium automatically. |
| **Referral program** | Every user gets a referral link. The referrer gets free premium days when a referred user pays. |
| **Affiliate marketing** | Broker cards with your affiliate links, click tracking through `/go/ID` (total, unique, per page), and "Trade on X" buttons on every signal. |
| **Email opt-in** | Popup (timed + exit-intent), footer, homepage and registration opt-ins. Consent text, IP and date are stored. CSV export (with unsubscribe links) and CSV import, and an unsubscribe page. |
| **Telegram** | Auto-posts signals to free/premium channels, sends a premium teaser to the free channel, and posts WIN/LOSS results. |
| **CMS** | Blog posts (visual + HTML editor), custom pages (themed or raw full-HTML landing pages), menu/footer links, media library with uploads. |
| **Custom code** | `<head>` code (Analytics, Pixel), body/footer scripts, custom CSS/JS, 3 ad slots, per-page CSS. |
| **Customise** | Logo, favicon, colours, all homepage texts, disclaimer, timezone, ticker symbols, social links, all from Admin → Settings. |
| **Live UI** | TradingView ticker + chart on every signal, countdown timers, auto-refresh, and new-signal toast + browser notification. |
| **Security** | `password_hash`, PDO prepared statements, CSRF on every form, login rate-limit, honeypots, safe image uploads (no PHP execution in /uploads), and blocked internal folders. |

## Requirements

- PHP **8.1+** with `pdo_mysql`, `curl` and `mbstring`. Hostinger has all of these.
- MySQL 5.7+ / MariaDB 10.3+
- Apache or LiteSpeed with `.htaccess` (Hostinger uses LiteSpeed)

## Install on Hostinger (about 10 minutes)

1. **Domain + hosting**: in hPanel → Websites, add your domain.
2. **PHP version**: hPanel → Advanced → PHP Configuration → choose **PHP 8.2** (or 8.1/8.3).
3. **Database**: hPanel → Databases → MySQL Databases → create a database + user and note the name, user and password.
4. **Upload files**: hPanel → File Manager → `public_html` → upload a ZIP of the *contents* of this `signal-script` folder → Extract. `index.php` must sit directly in `public_html`.
5. **Run the installer**: open `https://yourdomain.com/install.php`, fill in the database and admin details, then click *Install now*.
6. **Delete `install.php`** in File Manager.
7. **Cron job** (this makes signals automatic): hPanel → Advanced → Cron Jobs → *Custom* → every minute (`* * * * *`):
   ```
   /usr/bin/php /home/u123456789/domains/yourdomain.com/public_html/cron.php
   ```
   Admin → Dashboard shows the exact path for your account. You can also use the cron URL with an external service such as cron-job.org.
8. **SSL**: hPanel → Security → SSL → install the free SSL certificate.

Then log in at `https://yourdomain.com/login`. Admin users go straight to `/admin/`.

### After installing

1. **Settings → Signal engine**: add a **free Twelve Data API key** (https://twelvedata.com) for forex pairs. Crypto pairs (BTCUSDT…) work without a key.
2. **Affiliate brokers**: replace "Example Broker" with your real affiliate links.
3. **Premium plans** and **Settings → Payments**: set prices, wallet addresses and bKash/Nagad numbers.
4. **Settings → Telegram** (optional): create a bot with @BotFather, add it as an admin of your channels, paste the token and channel IDs, then click *Test Telegram* on the dashboard.
5. **Settings → General / Homepage**: logo, colours, texts, timezone.
6. **Settings → Custom code**: Google Analytics, Facebook Pixel, live chat, ads.

## Signal engine & API budget

The engine fetches data **only when a new candle closes** for each timeframe, so a cron that runs every minute stays inside free API limits.

| Data source | Used for | Key | Free limit |
|---|---|---|---|
| Binance public market data | Symbols without a slash: `BTCUSDT`, `ETHUSDT`, `SOLUSDT`… | No | Very high |
| Twelve Data | Symbols with a slash: `EUR/USD`, `GBP/JPY`, `XAU/USD`… | Free key | 800 calls/day, 8/min |

Each forex pair costs one call per candle. Approximate calls per day:

| Timeframe | 1min | 5min | 15min | 1h |
|---|---|---|---|---|
| Calls/day per pair | 1440 | 288 | 96 | 24 |

The default setup (EUR/USD binary on 5min, plus EUR/USD and XAU/USD forex on 15min) uses about 500 calls/day. The engine stops itself at the *daily call budget* (Settings, default 790). If you want more forex pairs or 1-minute binary signals on forex, upgrade your Twelve Data plan, or use crypto pairs, which are unlimited.

**How a signal is chosen:** each indicator votes BUY or SELL (EMA trend, fresh EMA crossover, EMA 50 trend, RSI momentum/reversal, MACD histogram, candle body). A signal is published only when a *fresh trigger* fires (an EMA crossover or a MACD histogram flip in the same direction) **and** the confidence is above your minimum. One open signal per asset at a time. You can also post **manual signals** from Admin → Signals.

> ⚠️ Technical indicators do **not** guarantee profits, and no engine wins every trade. The script shows real wins *and* losses. Keep the risk disclaimer visible. Binary options are banned for retail traders in some countries (EU, UK, USA and others), so check the law where you and your visitors are.

## File structure

```
index.php          front controller (all public pages)
admin/             admin panel (index.php + entities.php + views/)
cron.php           signal engine runner (cron job)
install.php        one-time installer, DELETE after install
inc/               bootstrap, helpers, engine, schema.sql (web access blocked)
views/             theme templates (edit to change the design)
assets/            css + js
uploads/           media uploads (script execution blocked)
storage/           lock files (web access blocked)
```

## Customising the design

- Colours, logo, texts and CSS overrides: **Admin → Settings**, no code needed.
- Bigger changes: edit `views/*.php` (plain PHP + HTML) and `assets/css/style.css`.
- A full custom landing page: Admin → Pages → new page → tick **Raw page** and paste any HTML.

## Moving to another host

Copy all files and `config.php`, export/import the database with phpMyAdmin, and change `base_url` in `config.php` if the domain changed.

---

## বাংলা সংক্ষিপ্ত গাইড

1. Hostinger hPanel থেকে PHP 8.2 সিলেক্ট করুন এবং একটি MySQL ডাটাবেস তৈরি করুন।
2. `signal-script` ফোল্ডারের সব ফাইল `public_html`-এ আপলোড করুন।
3. `https://আপনার-ডোমেইন/install.php` খুলে ডাটাবেস ও অ্যাডমিন তথ্য দিন, তারপর **install.php ডিলিট করুন**।
4. Cron Jobs-এ প্রতি মিনিটে `cron.php` চালানোর জন্য একটি cron যোগ করুন। এতে অটো সিগন্যাল তৈরি হবে এবং WIN/LOSS অটো চেক হবে।
5. Admin → Settings → Signal engine-এ ফ্রি Twelve Data API key দিন (ফরেক্স পেয়ারের জন্য)। ক্রিপ্টো পেয়ার key ছাড়াই চলে।
6. Affiliate brokers-এ আপনার অ্যাফিলিয়েট লিংক, Premium plans-এ দাম এবং Payments-এ bKash/Nagad/USDT নম্বর দিন।
7. Email list থেকে সব সাবস্ক্রাইবারের ইমেইল CSV হিসেবে ডাউনলোড করে Mailchimp/Brevo দিয়ে নিউজলেটার পাঠাতে পারবেন।
