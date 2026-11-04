<?php
/**
 * ToolHub configuration.
 *
 * 1. Copy this file to "config.php" in the same folder.
 * 2. Fill in your values. Leave a gateway's keys empty to keep it switched off.
 * 3. NEVER share config.php or commit it to GitHub — it contains your secret keys.
 */
return [
    'app' => [
        'name'      => 'ToolHub',
        // Full URL of your site, no trailing slash. Must be https:// in production.
        'base_url'  => 'https://yourdomain.com',
        'timezone'  => 'UTC', // e.g. America/New_York, Europe/London, Asia/Dubai
        // People who register/log in with these emails become admins.
        'admin_emails' => ['you@example.com'],
        // Keep false on a live site (true shows PHP errors on screen).
        'debug'     => false,
        // Credits can only be used while a monthly plan is active.
        'require_active_plan' => true,
        // Max tool runs per user per minute (abuse protection).
        'tool_runs_per_minute' => 6,
        // Address used for password-reset emails (create it in cPanel > Email Accounts).
        'mail_from' => 'no-reply@yourdomain.com',
        'support_email' => 'support@yourdomain.com',
    ],

    // cPanel > MySQL Databases: create a database + user, give the user ALL PRIVILEGES.
    'db' => [
        'host' => 'localhost',
        'name' => 'cpaneluser_toolhub',
        'user' => 'cpaneluser_toolhub',
        'pass' => 'change-me',
    ],

    // AI tools. Get a key at https://console.anthropic.com
    'anthropic' => [
        'api_key' => '',
        // claude-opus-5-5 = best quality. For lower cost per run you can use
        // claude-sonnet-5-5 or claude-haiku-5-5 (cheapest).
        'model'   => 'claude-opus-5-5',
        // low | medium | high — lower is faster and cheaper.
        'effort'  => 'medium',
        'max_tokens' => 16000,
        // If Claude declines a request, retry automatically on a fallback model.
        'fallbacks' => true,
    ],

    // Live keyword data. https://dataforseo.com (pay as you go)
    'dataforseo' => [
        'login'    => '',
        'password' => '',
        'location_code' => 2840, // 2840 = United States, 2826 = United Kingdom, 2124 = Canada, 2036 = Australia
        'language_code' => 'en',
    ],

    'payments' => [
        // All payments are charged in US dollars (USD).

        // Stripe — credit/debit cards, Apple Pay, Google Pay (needs a Stripe account in a supported country).
        'stripe' => [
            'secret_key'     => '',   // sk_live_... or sk_test_...
            'webhook_secret' => '',   // whsec_...
        ],
        // PayPal REST app (developer.paypal.com > Apps & Credentials). PayPal also accepts cards.
        'paypal' => [
            'sandbox'   => true,
            'client_id' => '',
            'secret'    => '',
        ],
        // NOWPayments — crypto (USDT, BTC, ETH, LTC, TRX, BNB and more).
        'nowpayments' => [
            'sandbox'    => false,
            'api_key'    => '',
            'ipn_secret' => '',
        ],
        // Binance Pay merchant API (merchant.binance.com).
        'binancepay' => [
            'api_key'    => '',
            'secret_key' => '',
        ],
    ],
];
