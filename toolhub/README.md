# ToolHub: AI and SEO tools website (PHP + MySQL, runs on cPanel)

ToolHub is a website you own and sell under your own brand. Customers sign up, buy a monthly plan, and use 25+ AI and SEO tools. The tools run on **official APIs**: Claude for AI and DataForSEO for keyword data. No accounts are shared, so the business is legal and you control it.

## Features

- **25+ tools**: Blog Writer, Paraphraser, Grammar Checker, Translator, Bangla Writer, SEO Meta, Keyword Ideas, live Keyword Research, YouTube Script, Ad Copy, Product Description, Email Writer, Business Name, Code Generator and more. From the admin panel you can add new tools, change their prices, or switch them off.
- **Plan + credit system**: monthly plans and top-up credits. Every tool run uses some credits. If a tool fails, the credits are refunded automatically.
- **Payments**:

  | Method | Type | Currency |
  |---|---|---|
  | bKash Tokenized Checkout | Automatic (API) | BDT |
  | SSLCommerz (Visa, Mastercard, Nagad, Rocket, banks) | Automatic | BDT |
  | Stripe (international cards) | Automatic | USD |
  | PayPal | Automatic | USD |
  | NOWPayments (USDT, BTC, ETH and 100+ coins) | Automatic | USD |
  | Binance Pay merchant | Automatic | USDT |
  | bKash, Nagad Send Money | Manual (customer submits TrxID, admin approves) | BDT |
  | Binance Pay ID, Bybit UID, USDT TRC20, Wise | Manual | USD |

- **Admin panel**: approve payments, manage users (add or remove credits, extend plans, ban), and manage tools, packages and payment methods. It also has a setup checklist.
- **Customer panel**: dashboard, tools list (category filter, search, pin), payment history, usage history, account settings, forgot password.

## Security (already built in)

- Passwords are stored with bcrypt (`password_hash`). There is a login rate limit (5 failed tries locks login for 15 minutes).
- Every form has a CSRF token. Session cookies are HttpOnly, SameSite and Secure, and the session ID is regenerated after login.
- All database queries use prepared statements (SQL injection protection). Everything shown on a page is escaped (XSS protection).
- Security headers are set: Content-Security-Policy, X-Frame-Options, HSTS, nosniff.
- **Price is calculated on the server.** The browser cannot change the amount.
- **An order counts as paid only after the server checks it with the gateway itself** (bKash execute/status, SSLCommerz validation API, Stripe session fetch plus webhook signature, PayPal capture, NOWPayments HMAC signature, Binance signed query). Opening the "success" URL alone does nothing.
- The amount and currency the gateway confirms must exactly match the order.
- Credits are delivered inside a database transaction with a unique ledger key. If a webhook and the return page arrive together, credits are still added only once.
- A gateway whose keys are not set rejects all webhooks.
- A manual payment TrxID can be used only once.
- The `app` folder (code and config) is kept outside `public_html`, so nobody can download it from the web.

---

## Installation on cPanel (step by step)

### What you need
- cPanel hosting with **PHP 8.1 or newer** (8.2/8.3 is better) and MySQL/MariaDB
- A domain with SSL (cPanel > SSL/TLS Status > Run AutoSSL, free)

### Step 1: Set the PHP version
cPanel > **Select PHP Version** (or MultiPHP Manager). Choose PHP 8.2 or 8.3. Make sure these extensions are on: `curl`, `mbstring`, `pdo_mysql`, `openssl`, `json`.

### Step 2: Create the database
1. cPanel > **MySQL Databases**
2. Create a new database, for example `toolhub`. The full name will look like `cpaneluser_toolhub`.
3. Create a new user with a strong password.
4. Add the user to the database and give it **ALL PRIVILEGES**.
5. cPanel > **phpMyAdmin**. Select the database > **Import** > upload `database/schema.sql` > Go.

### Step 3: Upload the files
Your hosting folders look like this (`youruser` is your cPanel username):

```
/home/youruser/
├── toolhub_app/      ← put the contents of the "app" folder here (NOT inside public_html)
└── public_html/      ← put the contents of the "public_html" folder here
```

1. cPanel > **File Manager** > open `/home/youruser/` (one level above public_html)
2. Create a new folder named `toolhub_app`. Upload the **contents** of the zip's `app` folder into it (bootstrap.php, routes.php, lib, payments, views, storage, vendor…).
3. Upload the **contents** of the zip's `public_html` folder (index.php, .htaccess, assets) into your `public_html` folder.
   - In File Manager, turn on Settings > "Show Hidden Files" so you can see `.htaccess`.

> The `vendor` folder (the Claude SDK) is already in the zip. If you download the code from GitHub, it will not be there. In that case, open cPanel **Terminal** and run this inside `toolhub_app`:

```bash
composer install --no-dev
```

### Step 4: Fill in the config
1. In `toolhub_app`, make a copy of `config.sample.php` and name it `config.php`.
2. Edit `config.php` and fill in:
   - `base_url` → `https://yourdomain.com`
   - `admin_emails` → your own email (you become admin when you register with it)
   - `db` → the database name, user and password from step 2
   - `anthropic.api_key` → get it from https://console.anthropic.com (needed for the AI tools)
   - Keys for the payment gateways you want to use (see below)
   - `debug` → keep it `false`
3. Set the permission of the `toolhub_app/storage` folder to **755**.

### Step 5: Turn on HTTPS
In `public_html/.htaccess`, remove the `#` from the start of these two lines so the site always uses HTTPS:

```
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

### Step 6: First login
1. Go to `https://yourdomain.com/register` and create an account with the email you put in `admin_emails`.
2. The **Admin** menu now appears in the sidebar. Open Admin > Overview and check the **Setup checklist**. Everything should be ✅.
3. In Admin > **Payment Methods**, enter your bKash/Nagad number, Binance Pay ID, Bybit UID, USDT address and Wise email, then switch on the methods you want.
4. In Admin > **Packages**, set your prices.

---

## Payment gateway setup

Fill in the keys under `payments` in `config.php`. Then switch the method on in Admin > Payment Methods. A gateway without keys never shows up at checkout.

| Gateway | Where to get keys | Webhook / callback URL |
|---|---|---|
| **bKash** | Merchant account → bKash PGW team gives you app_key, app_secret, username, password | Set automatically (`/pay/bkash/return`) |
| **SSLCommerz** | https://sslcommerz.com → merchant registration → store_id, store_password | IPN: `https://yourdomain.com/pay/sslcommerz/webhook` |
| **Stripe** | dashboard.stripe.com → Developers → API keys | Webhook: `https://yourdomain.com/pay/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`. Put the whsec_ secret in config. |
| **PayPal** | developer.paypal.com → Apps & Credentials → client_id, secret | No webhook needed (captured on return) |
| **NOWPayments** | nowpayments.io → Settings → API key + IPN secret | IPN: `https://yourdomain.com/pay/nowpayments/webhook` (set automatically on every invoice) |
| **Binance Pay** | merchant.binance.com → Developers → API key + secret | Set automatically (`/pay/binancepay/webhook`) |

Test in `sandbox => true` first. Only switch to `false` once it works.

> **Important for Bangladesh:** Stripe does not open accounts for merchants based in Bangladesh, and receiving money through PayPal in Bangladesh is also restricted. For cards, use **SSLCommerz** (it also covers Nagad and Rocket). For international customers, crypto (NOWPayments or Binance Pay) or manual Wise is usually the practical option. Stripe and PayPal work only if you have a business registered in a supported country.

### Approving manual payments (bKash, Nagad, Binance, Bybit, USDT, Wise)
1. The customer sends the money and submits the TrxID. The order shows as "Under review".
2. In Admin > **Payments**, check the TrxID and the **exact amount** in your own bKash/Nagad/Binance app.
3. If it matches, click **Approve**. Credits are added immediately. If it does not match, click **Reject**.

---

## Tools and API costs

- AI tools use the Claude API. The default model is `claude-opus-5-5` (best quality). To lower costs, change `anthropic.model` in `config.php` to `claude-sonnet-5-5` or `claude-haiku-5-5` (cheapest).
- Set credit prices so that what you earn from a plan is more than what the API costs you. Check your spending at console.anthropic.com > Usage.
- Live Keyword Research uses DataForSEO (pay as you go). Without `dataforseo` keys, the tool shows as "unavailable".
- To add a new AI tool: Admin > Tools > **+ New tool**. Give it a name, a category, a credit price and the AI instructions, and it is ready. No code needed.

## Folder structure

```
toolhub/
├── app/                  → upload to /home/youruser/toolhub_app (outside public_html)
│   ├── config.sample.php → copy to config.php and fill in
│   ├── bootstrap.php, routes.php, admin.php
│   ├── lib/              → core, auth, credits, orders, tools (Claude + DataForSEO)
│   ├── payments/         → bkash, sslcommerz, stripe, paypal, nowpayments, binancepay
│   ├── views/            → HTML templates
│   ├── storage/          → error log (not reachable from the web)
│   └── composer.json     → Anthropic PHP SDK + Guzzle
├── public_html/          → upload to public_html
│   ├── index.php, .htaccess
│   └── assets/app.css, app.js
└── database/schema.sql   → import in phpMyAdmin
```

## Troubleshooting

- **500 error / blank page**: check `toolhub_app/storage/error.log`. For a short time you can set `debug => true` to see the error on screen, then set it back to `false`.
- **"app folder not found"**: `toolhub_app` must be one level above `public_html` (`/home/youruser/toolhub_app`).
- **Password reset emails not arriving**: create the `mail_from` address in cPanel > Email Accounts.
- **"Your session expired"**: refresh the page and try again (the CSRF token had expired).
