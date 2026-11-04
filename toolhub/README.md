# ToolHub: AI & SEO tools website (PHP + MySQL, runs on cPanel)

ToolHub is a ready-to-run SaaS website you own and sell under your own brand.
Customers sign up, buy a monthly plan in **US dollars**, and use 25+ AI and SEO tools.
Tools are powered by **official APIs** (Claude for AI, DataForSEO for keyword data), so no accounts are shared and the business is legal and fully under your control.

## Features

- **25+ tools**: AI Blog Writer, Article Rewriter, Paraphraser, Grammar Checker, Summarizer, Translator, SEO Meta Generator, Keyword Ideas, live Keyword Research, Blog Outline, FAQ Generator, Social Media Captions, Hashtags, YouTube Script, YouTube Title & Tags, Ad Copy, Product Description, Email Writer, Landing Page Copy, Business Names, Cover Letter, Business Plan, Code Explainer, Code Generator, Regex Generator. In the admin panel you can add new tools, change prices, or switch tools off.
- **Plans + credits**: monthly plans and top-up credit packs. Every tool run costs a few credits. If a tool fails, the credits are refunded automatically.
- **Payments, all in USD**:

  | Method | Type | How it works |
  |---|---|---|
  | Credit / debit card (Stripe) | Automatic | Visa, Mastercard, Amex, Apple Pay, Google Pay |
  | PayPal | Automatic | PayPal balance, or any card through PayPal |
  | Crypto (NOWPayments) | Automatic | USDT (TRC20/ERC20/BEP20), BTC, ETH, LTC, BNB, TRX, 100+ coins |
  | Binance Pay (merchant) | Automatic | Customer pays from the Binance app |
  | USDT TRC20 / USDT BEP20 wallet | Manual | Customer sends USDT and submits the TxID, you approve |
  | Binance Pay ID | Manual | Customer sends to your Pay ID and submits the Order ID |
  | Bybit UID transfer | Manual | Customer sends to your UID and submits the transfer ID |
  | Wise | Manual | Customer sends USD to your Wise email and submits the transfer number |

- **Admin panel**: review and approve payments; manage users (add or remove credits, extend plans, ban); manage tools, packages and payment methods; a setup checklist.
- **Customer area**: dashboard, tools list (category filter, search, pin favourites), payment history, usage history with saved results, account settings, password reset.

## Security (built in)

- Passwords are hashed with bcrypt. Login is rate-limited: after 5 failed attempts, logins are locked for 15 minutes.
- Every form has a CSRF token. Session cookies are HttpOnly, SameSite and Secure (on HTTPS), and the session ID is regenerated after login.
- All database queries use prepared statements (SQL-injection safe), and all output is escaped (XSS safe).
- Security headers: Content-Security-Policy, X-Frame-Options, HSTS, nosniff.
- **Prices are calculated on the server.** The browser can never change the amount.
- **An order is only marked paid after the server itself confirms it with the provider**: Stripe session lookup plus signed webhook, PayPal capture, NOWPayments HMAC signature, Binance signed order query. Visiting a "success" URL alone does nothing.
- The amount the provider confirms must exactly match the order amount in USD/USDT.
- Credits are delivered inside a database transaction with a unique ledger key. If a webhook and the return page arrive at the same time, credits are still added only once.
- A gateway with no keys configured rejects every webhook.
- A transaction ID for a manual payment can be used only once.
- The `app` folder (code, config, secret keys) is kept outside `public_html`, so it can't be downloaded from the web.

---

## Installation on cPanel (step by step)

### You need
- cPanel hosting with **PHP 8.1 or newer** (8.2 or 8.3 recommended) and MySQL/MariaDB
- A domain with SSL. In cPanel, go to SSL/TLS Status and click Run AutoSSL (free).

### Step 1: PHP version
In cPanel, open **Select PHP Version** (or MultiPHP Manager) and choose PHP 8.2 or 8.3. Make sure these extensions are enabled: `curl`, `mbstring`, `pdo_mysql`, `openssl`, `json`.

### Step 2: Database
1. In cPanel, open **MySQL Databases**.
2. Create a database, for example `toolhub`. The full name becomes `cpaneluser_toolhub`.
3. Create a user with a strong password.
4. Add the user to the database with **ALL PRIVILEGES**.
5. In cPanel, open **phpMyAdmin**, select the database, click **Import**, upload `database/schema.sql`, and click Go.

### Step 3: Upload the files
Your hosting folders should look like this (`youruser` is your cPanel username):

```
/home/youruser/
├── toolhub_app/      ← contents of the "app" folder (NOT inside public_html)
└── public_html/      ← contents of the "public_html" folder
```

1. In cPanel, open **File Manager** and go to `/home/youruser/` (one level above public_html).
2. Create a folder named `toolhub_app` and upload the **contents** of the zip's `app` folder into it (bootstrap.php, routes.php, lib, payments, views, storage, vendor, …).
3. Upload the **contents** of the zip's `public_html` folder (index.php, .htaccess, assets) into your `public_html`.
   - In File Manager, open Settings and turn on "Show Hidden Files" so you can see `.htaccess`.

> The ready-made zip already contains the `vendor` folder (Claude SDK). If you got the code from GitHub instead, open cPanel **Terminal**, go to `toolhub_app`, and run:

```bash
composer install --no-dev
```

### Step 4: Configuration
1. In `toolhub_app`, copy `config.sample.php` to `config.php`.
2. Edit `config.php`:
   - `base_url`: `https://yourdomain.com`
   - `admin_emails`: your own email. The account you register with this email becomes admin.
   - `db`: the database name, user and password from step 2
   - `anthropic.api_key`: your key from https://console.anthropic.com (required for the AI tools)
   - keys for the payment gateways you want (see below)
   - keep `debug` set to `false`
3. Set the permission of `toolhub_app/storage` to **755**.

### Step 5: Force HTTPS
In `public_html/.htaccess`, remove the `#` in front of these two lines:

```
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

### Step 6: First login
1. Open `https://yourdomain.com/register` and sign up with the email you put in `admin_emails`.
2. The **Admin** menu now appears in the sidebar. Open Admin > Overview and check that every item in the **Setup checklist** shows ✅.
3. In Admin > **Payment Methods**, enter your USDT wallet addresses, Binance Pay ID, Bybit UID and Wise email, then switch on the methods you want. All methods are **off** by default, so customers never see placeholder addresses.
4. In Admin > **Packages**, set your USD prices.

---

## Payment gateway setup

Put the keys under `payments` in `config.php`, then switch the method on in Admin > Payment Methods. A gateway without keys never appears at checkout.

| Gateway | Where to get keys | Webhook / callback |
|---|---|---|
| **Stripe** (cards) | dashboard.stripe.com → Developers → API keys | Add a webhook endpoint `https://yourdomain.com/pay/stripe/webhook` with events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Put its `whsec_…` secret in config. |
| **PayPal** | developer.paypal.com → Apps & Credentials → Client ID + Secret | None needed (payment is captured when the customer returns) |
| **NOWPayments** (crypto) | nowpayments.io → Settings → API key + IPN secret | Sent automatically with every invoice: `https://yourdomain.com/pay/nowpayments/webhook` |
| **Binance Pay** | merchant.binance.com → Developers → API key + Secret | Sent automatically: `https://yourdomain.com/pay/binancepay/webhook` |

Test with `sandbox => true` (PayPal) or Stripe test keys (`sk_test_…`) first, then switch to live keys.

> Stripe and PayPal business accounts are only available in supported countries. If you can't open one, use crypto (NOWPayments, Binance Pay), USDT, Bybit and Wise. Between them, customers can still pay from almost anywhere.

### Approving manual payments (USDT, Binance Pay ID, Bybit, Wise)
1. The customer sends the money and submits the transaction ID. The order shows as "Under review".
2. In Admin > **Payments**, find the order. Check in your own Binance, Bybit, wallet or Wise account that the transaction exists and the **exact amount** arrived. For USDT, also check the network.
3. If it matches, click **Approve** and the credits are added instantly. If not, click **Reject**.

---

## Tools and API costs

- AI tools use the Claude API. The default model is `claude-opus-5-5` (best quality). To lower your costs, set `anthropic.model` in `config.php` to `claude-sonnet-5-5` or `claude-haiku-5-5` (cheapest).
- Set credit prices so that plan revenue is higher than your API cost. You can see your usage at console.anthropic.com > Usage.
- Live Keyword Research uses DataForSEO (pay as you go). Without `dataforseo` keys, that tool shows as "unavailable". `location_code` 2840 means United States.
- To add a new AI tool, go to Admin > Tools > **+ New tool**, fill in the name, category, credit cost and AI instructions, and save. No coding needed.

## Folder structure

```
toolhub/
├── app/                  → upload to /home/youruser/toolhub_app (outside public_html)
│   ├── config.sample.php → copy to config.php and fill in
│   ├── bootstrap.php, routes.php, admin.php
│   ├── lib/              → core, auth, credits, orders, tools (Claude + DataForSEO)
│   ├── payments/         → stripe, paypal, nowpayments, binancepay
│   ├── views/            → HTML templates
│   ├── storage/          → error log (not reachable from the web)
│   └── composer.json     → Anthropic PHP SDK + Guzzle
├── public_html/          → upload into public_html
│   ├── index.php, .htaccess
│   └── assets/app.css, app.js
└── database/schema.sql   → import in phpMyAdmin
```

## Troubleshooting

- **500 error or blank page**: check `toolhub_app/storage/error.log`. You can briefly set `debug => true` to see the error on screen, but set it back to `false` afterwards.
- **"app folder not found"**: `toolhub_app` must sit one level above `public_html` (`/home/youruser/toolhub_app`).
- **Password-reset emails not arriving**: create the `mail_from` address in cPanel > Email Accounts.
- **"Your session expired"**: refresh the page and submit again (the security token expired).
