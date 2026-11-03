<?php
declare(strict_types=1);

/**
 * Declarative definitions used by the generic admin CRUD.
 * Field types: text, textarea, html, code, number, decimal, checkbox, select, image, url
 */
function admin_entities(): array
{
    $status = ['published' => 'Published', 'draft' => 'Draft'];
    $tf = ['1min' => '1 min', '5min' => '5 min', '15min' => '15 min', '30min' => '30 min', '1h' => '1 hour', '4h' => '4 hours', '1day' => '1 day'];

    return [
        'signals' => [
            'table' => 'signals', 'title' => 'Signals', 'singular' => 'signal', 'order' => 'id DESC',
            'search' => ['asset'],
            'filters' => [
                'status' => ['active' => 'Active', 'win' => 'Win', 'loss' => 'Loss', 'expired' => 'Expired', 'cancelled' => 'Cancelled'],
                'market' => ['binary' => 'Binary', 'forex' => 'Forex', 'crypto' => 'Crypto'],
                'source' => ['auto' => 'Auto', 'manual' => 'Manual'],
            ],
            'columns' => [
                'id' => '#',
                'asset' => 'Asset',
                'market' => 'Market',
                'direction' => fn($r) => '<span class="' . ($r['direction'] === 'BUY' ? 'up' : 'down') . '">' . e(signal_label($r)) . '</span>',
                'entry' => fn($r) => fmt_price($r['entry']),
                'confidence' => fn($r) => (int)$r['confidence'] . '%',
                'is_premium' => fn($r) => (int)$r['is_premium'] ? '⭐' : '',
                'source' => 'Source',
                'status' => fn($r) => '<span class="badge b-' . e($r['status']) . '">' . e($r['status']) . '</span>',
                'created_at' => fn($r) => e(fmt_time($r['created_at'])),
            ],
            'view' => fn($r) => url('signal/' . $r['id']),
            'actions' => [
                'win' => ['label' => 'Mark win', 'show' => fn($r) => $r['status'] === 'active', 'fn' => fn($r) => q("UPDATE signals SET status='win', closed_at=? WHERE id=?", [now_utc(), $r['id']])],
                'loss' => ['label' => 'Mark loss', 'show' => fn($r) => $r['status'] === 'active', 'fn' => fn($r) => q("UPDATE signals SET status='loss', closed_at=? WHERE id=?", [now_utc(), $r['id']])],
                'cancel' => ['label' => 'Cancel', 'show' => fn($r) => $r['status'] === 'active', 'fn' => fn($r) => q("UPDATE signals SET status='cancelled', closed_at=? WHERE id=?", [now_utc(), $r['id']])],
                'resend' => ['label' => 'Re-send Telegram', 'show' => fn($r) => $r['status'] === 'active', 'fn' => function ($r) {
                    q('UPDATE signals SET telegram_sent = 0 WHERE id = ?', [$r['id']]);
                    telegram_flush();
                }],
            ],
            'fields' => [
                'market' => ['label' => 'Market', 'type' => 'select', 'options' => ['binary' => 'Binary options', 'forex' => 'Forex', 'crypto' => 'Crypto']],
                'asset' => ['label' => 'Asset', 'type' => 'text', 'required' => true, 'help' => 'e.g. EUR/USD, XAU/USD, BTCUSDT'],
                'direction' => ['label' => 'Direction', 'type' => 'select', 'options' => ['BUY' => 'BUY / CALL ▲', 'SELL' => 'SELL / PUT ▼']],
                'timeframe' => ['label' => 'Timeframe', 'type' => 'select', 'options' => $tf],
                'entry' => ['label' => 'Entry price', 'type' => 'decimal', 'required' => true],
                'expiry_minutes' => ['label' => 'Expiry / validity (minutes)', 'type' => 'number', 'default' => 5, 'help' => 'Binary: option expiry. Forex: how long the signal stays open (e.g. 1440 = 24h).'],
                'stop_loss' => ['label' => 'Stop loss (forex/crypto)', 'type' => 'decimal'],
                'take_profit' => ['label' => 'Take profit 1', 'type' => 'decimal'],
                'take_profit2' => ['label' => 'Take profit 2', 'type' => 'decimal'],
                'confidence' => ['label' => 'Confidence %', 'type' => 'number', 'default' => 75],
                'analysis' => ['label' => 'Analysis / notes', 'type' => 'textarea'],
                'is_premium' => ['label' => 'Premium only', 'type' => 'checkbox'],
                'status' => ['label' => 'Status', 'type' => 'select', 'options' => ['active' => 'Active', 'win' => 'Win', 'loss' => 'Loss', 'expired' => 'Expired', 'cancelled' => 'Cancelled']],
                'close_price' => ['label' => 'Close price (optional)', 'type' => 'decimal'],
            ],
            'before_save' => function (array $d, ?array $row): array {
                $created = $row['created_at'] ?? now_utc();
                $d['asset'] = strtoupper($d['asset']);
                $d['confidence'] = max(1, min(99, (int)$d['confidence']));
                $d['expiry_minutes'] = max(1, (int)$d['expiry_minutes']);
                $d['expires_at'] = gmdate('Y-m-d H:i:s', strtotime($created . ' UTC') + $d['expiry_minutes'] * 60);
                if (!$row) {
                    $d['source'] = 'manual';
                    $d['created_at'] = $created;
                }
                if ($d['status'] !== 'active' && empty($row['closed_at'])) {
                    $d['closed_at'] = now_utc();
                }
                return $d;
            },
            'after_save' => fn(int $id) => telegram_flush(),
        ],

        'posts' => [
            'table' => 'posts', 'title' => 'Blog posts', 'singular' => 'post', 'order' => 'id DESC',
            'search' => ['title', 'category'],
            'filters' => ['status' => $status],
            'columns' => [
                'title' => fn($r) => '<strong>' . e($r['title']) . '</strong>',
                'category' => 'Category',
                'is_premium' => fn($r) => (int)$r['is_premium'] ? '⭐' : '',
                'status' => fn($r) => '<span class="badge b-' . e($r['status']) . '">' . e($r['status']) . '</span>',
                'views' => 'Views',
                'created_at' => fn($r) => e(fmt_time($r['created_at'], 'M j, Y')),
            ],
            'view' => fn($r) => url('blog/' . $r['slug']),
            'fields' => [
                'title' => ['label' => 'Title', 'type' => 'text', 'required' => true],
                'slug' => ['label' => 'URL slug', 'type' => 'text', 'help' => 'Leave empty to generate from title.'],
                'category' => ['label' => 'Category', 'type' => 'text', 'help' => 'e.g. Forex, Binary, Crypto, Education'],
                'image_url' => ['label' => 'Featured image', 'type' => 'image'],
                'excerpt' => ['label' => 'Short summary', 'type' => 'textarea'],
                'content' => ['label' => 'Content', 'type' => 'html'],
                'meta_description' => ['label' => 'SEO description', 'type' => 'text'],
                'is_premium' => ['label' => 'Premium members only', 'type' => 'checkbox'],
                'status' => ['label' => 'Status', 'type' => 'select', 'options' => $status],
            ],
            'before_save' => function (array $d, ?array $row): array {
                $d['updated_at'] = now_utc();
                return $d;
            },
        ],

        'pages' => [
            'table' => 'pages', 'title' => 'Pages', 'singular' => 'page', 'order' => 'sort_order, id',
            'search' => ['title'],
            'columns' => [
                'title' => fn($r) => '<strong>' . e($r['title']) . '</strong>',
                'slug' => fn($r) => '<code>/p/' . e($r['slug']) . '</code>',
                'in_menu' => fn($r) => (int)$r['in_menu'] ? 'Header' : '',
                'in_footer' => fn($r) => (int)$r['in_footer'] ? 'Footer' : '',
                'bare' => fn($r) => (int)$r['bare'] ? 'Raw HTML' : 'Themed',
                'status' => fn($r) => '<span class="badge b-' . e($r['status']) . '">' . e($r['status']) . '</span>',
            ],
            'view' => fn($r) => url('p/' . $r['slug']),
            'fields' => [
                'title' => ['label' => 'Title', 'type' => 'text', 'required' => true],
                'slug' => ['label' => 'URL slug', 'type' => 'text', 'help' => 'Page URL: /p/your-slug'],
                'content' => ['label' => 'Content (HTML allowed)', 'type' => 'html'],
                'custom_css' => ['label' => 'Custom CSS for this page', 'type' => 'code'],
                'meta_description' => ['label' => 'SEO description', 'type' => 'text'],
                'in_menu' => ['label' => 'Show in header menu', 'type' => 'checkbox'],
                'in_footer' => ['label' => 'Show in footer', 'type' => 'checkbox'],
                'bare' => ['label' => 'Raw page (no site header/footer — paste a full HTML landing page)', 'type' => 'checkbox'],
                'sort_order' => ['label' => 'Menu order', 'type' => 'number'],
                'status' => ['label' => 'Status', 'type' => 'select', 'options' => $status],
            ],
        ],

        'brokers' => [
            'table' => 'brokers', 'title' => 'Brokers (affiliate)', 'singular' => 'broker', 'order' => 'featured DESC, sort_order, id',
            'search' => ['name'],
            'columns' => [
                'name' => fn($r) => '<strong>' . e($r['name']) . '</strong>',
                'bonus_text' => 'Bonus',
                'rating' => 'Rating',
                'clicks' => fn($r) => '<a href="' . e(admin_url('clicks')) . '">' . (int)$r['clicks'] . '</a>',
                'featured' => fn($r) => (int)$r['featured'] ? '★' : '',
                'active' => fn($r) => (int)$r['active'] ? 'Active' : 'Hidden',
            ],
            'view' => fn($r) => url('brokers'),
            'fields' => [
                'name' => ['label' => 'Broker name', 'type' => 'text', 'required' => true],
                'affiliate_url' => ['label' => 'Affiliate link', 'type' => 'url', 'required' => true, 'help' => 'Your tracking link. Visitors go through /go/ID so clicks are counted.'],
                'logo_url' => ['label' => 'Logo', 'type' => 'image'],
                'bonus_text' => ['label' => 'Bonus / offer', 'type' => 'text', 'help' => 'e.g. 100% deposit bonus'],
                'description' => ['label' => 'Short description', 'type' => 'textarea'],
                'markets' => ['label' => 'Markets', 'type' => 'text', 'help' => 'e.g. Binary · Forex · Crypto'],
                'min_deposit' => ['label' => 'Minimum deposit', 'type' => 'text'],
                'rating' => ['label' => 'Rating (0-5)', 'type' => 'decimal'],
                'featured' => ['label' => 'Featured (top pick)', 'type' => 'checkbox'],
                'active' => ['label' => 'Active', 'type' => 'checkbox', 'default' => 1],
                'sort_order' => ['label' => 'Order', 'type' => 'number'],
            ],
            'before_save' => function (array $d, ?array $row): array {
                $d['rating'] = max(0, min(5, (float)($d['rating'] ?? 4.5)));
                if (!preg_match('#^https?://#i', $d['affiliate_url'])) {
                    $d['affiliate_url'] = 'https://' . ltrim($d['affiliate_url'], '/');
                }
                return $d;
            },
        ],

        'plans' => [
            'table' => 'plans', 'title' => 'Premium plans', 'singular' => 'plan', 'order' => 'sort_order, price',
            'columns' => [
                'name' => fn($r) => '<strong>' . e($r['name']) . '</strong>',
                'price' => fn($r) => e($r['currency'] . ' ' . $r['price']),
                'duration_days' => fn($r) => (int)$r['duration_days'] . ' days',
                'highlight' => fn($r) => (int)$r['highlight'] ? 'Popular' : '',
                'active' => fn($r) => (int)$r['active'] ? 'Active' : 'Hidden',
            ],
            'view' => fn($r) => url('pricing'),
            'fields' => [
                'name' => ['label' => 'Plan name', 'type' => 'text', 'required' => true],
                'price' => ['label' => 'Price', 'type' => 'decimal', 'required' => true],
                'currency' => ['label' => 'Currency', 'type' => 'text', 'help' => 'USD, BDT, EUR, USDT…'],
                'duration_days' => ['label' => 'Duration (days)', 'type' => 'number', 'default' => 30],
                'features' => ['label' => 'Features (one per line)', 'type' => 'textarea'],
                'highlight' => ['label' => 'Highlight as most popular', 'type' => 'checkbox'],
                'active' => ['label' => 'Active', 'type' => 'checkbox', 'default' => 1],
                'sort_order' => ['label' => 'Order', 'type' => 'number'],
            ],
            'before_save' => function (array $d, ?array $row): array {
                $d['currency'] = strtoupper($d['currency'] ?: 'USD');
                $d['price'] = (float)$d['price'];
                $d['duration_days'] = max(1, (int)$d['duration_days']);
                return $d;
            },
        ],
    ];
}

/** Settings screens: key => [label, type, help] */
function admin_settings_groups(): array
{
    return [
        'general' => ['title' => 'General', 'fields' => [
            'site_name' => ['Site name', 'text'],
            'tagline' => ['Tagline', 'text'],
            'logo_url' => ['Logo', 'image', 'Leave empty to show the site name.'],
            'favicon_url' => ['Favicon', 'image'],
            'primary_color' => ['Primary color', 'color'],
            'accent_color' => ['Accent color', 'color'],
            'admin_email' => ['Admin email', 'text', 'Receives payment notifications; also used as "From" address.'],
            'display_timezone' => ['Display timezone', 'timezone'],
            'register_enabled' => ['Allow new registrations', 'checkbox'],
            'show_ticker' => ['Show live price ticker', 'checkbox'],
            'ticker_symbols' => ['Ticker symbols', 'textarea', 'One per line: TRADINGVIEW_SYMBOL|Title, e.g. FX_IDC:EURUSD|EUR/USD'],
            'social_telegram' => ['Telegram link', 'text'],
            'social_facebook' => ['Facebook link', 'text'],
            'social_youtube' => ['YouTube link', 'text'],
            'social_whatsapp' => ['WhatsApp link', 'text'],
        ]],
        'home' => ['title' => 'Homepage & text', 'fields' => [
            'hero_title' => ['Hero title', 'text'],
            'hero_subtitle' => ['Hero subtitle', 'textarea'],
            'hero_cta' => ['Hero button text', 'text'],
            'home_html' => ['Extra homepage section (HTML)', 'code', 'Shown after the active signals.'],
            'disclaimer' => ['Risk disclaimer', 'textarea', 'Shown in the footer and on signal pages. Keep it — it protects you legally.'],
            'footer_text' => ['Extra footer text (HTML)', 'code'],
        ]],
        'engine' => ['title' => 'Signal engine', 'fields' => [
            'auto_enabled' => ['Auto-generate signals', 'checkbox'],
            'twelvedata_key' => ['Twelve Data API key', 'text', 'Free key at twelvedata.com (800 calls/day). Needed for forex pairs like EUR/USD. Crypto (BTCUSDT) works without a key.'],
            'binary_assets' => ['Binary assets', 'textarea', 'One per line. EUR/USD style = forex via Twelve Data, BTCUSDT style = crypto via Binance.'],
            'binary_timeframe' => ['Binary analysis timeframe', 'select:1min,5min,15min'],
            'binary_expiry' => ['Binary expiry (minutes)', 'number'],
            'forex_assets' => ['Forex assets', 'textarea'],
            'forex_timeframe' => ['Forex timeframe', 'select:5min,15min,30min,1h,4h'],
            'forex_expiry_hours' => ['Forex/crypto signal validity (hours)', 'number'],
            'crypto_assets' => ['Crypto assets', 'textarea', 'Binance symbols, e.g. BTCUSDT, ETHUSDT, SOLUSDT'],
            'crypto_timeframe' => ['Crypto timeframe', 'select:5min,15min,30min,1h,4h'],
            'min_confidence' => ['Minimum confidence to publish (%)', 'number', '50–95. Higher = fewer but stronger signals.'],
            'premium_confidence' => ['Confidence for premium signals (%)', 'number', 'Signals at or above this are premium-only.'],
            'free_delay_minutes' => ['Delay for free users (minutes)', 'number', '0 = free signals appear instantly.'],
            'max_td_calls' => ['Max Twelve Data calls per run', 'number', 'Free plan allows 8 per minute.'],
            'td_daily_limit' => ['Twelve Data daily call budget', 'number', 'Free plan = 800/day. The engine fetches each forex pair once per candle: e.g. 2 pairs on 5min ≈ 576 calls/day; 1min forex pairs use 1440 calls/day EACH.'],
            'cron_key' => ['Cron secret key', 'text', 'Used in the cron URL. Change it if it leaks.'],
        ]],
        'telegram' => ['title' => 'Telegram', 'fields' => [
            'telegram_bot_token' => ['Bot token', 'text', 'Create a bot with @BotFather, add it as admin of your channels.'],
            'telegram_free_chat' => ['Free channel ID', 'text', '@yourchannel or -100xxxxxxxxxx'],
            'telegram_premium_chat' => ['Premium channel ID', 'text', 'Private channel for paying members.'],
            'telegram_results' => ['Post WIN/LOSS results', 'checkbox'],
        ]],
        'payments' => ['title' => 'Payments & referral', 'fields' => [
            'payment_methods' => ['Payment methods', 'textarea', 'One per line, shown in a dropdown.'],
            'payment_instructions' => ['Payment instructions', 'textarea', 'Wallet addresses / account numbers.'],
            'referral_reward_days' => ['Referral reward (premium days)', 'number', 'Given to the referrer when a referred user makes their first approved payment. 0 = off.'],
        ]],
        'optin' => ['title' => 'Email opt-in', 'fields' => [
            'optin_enabled' => ['Enable opt-in forms', 'checkbox'],
            'optin_popup' => ['Show popup to visitors', 'checkbox'],
            'optin_popup_delay' => ['Popup delay (seconds)', 'number'],
            'optin_title' => ['Opt-in title', 'text'],
            'optin_text' => ['Opt-in text', 'textarea'],
            'optin_consent' => ['Consent checkbox text', 'text', 'Stored with every subscriber as proof of consent.'],
        ]],
        'code' => ['title' => 'Custom code & ads', 'fields' => [
            'head_code' => ['Code inside <head>', 'code', 'Google Analytics, Facebook Pixel, meta tags, verification codes…'],
            'body_start_code' => ['Code after <body>', 'code', 'Google Tag Manager noscript etc.'],
            'footer_code' => ['Code before </body>', 'code', 'Live chat widgets, extra scripts.'],
            'custom_css' => ['Custom CSS', 'code', 'Overrides the theme.'],
            'custom_js' => ['Custom JavaScript', 'code', 'Without <script> tags.'],
            'ad_top' => ['Ad / banner: below header', 'code'],
            'ad_signals' => ['Ad / banner: signals page', 'code'],
            'ad_post' => ['Ad / banner: below blog posts', 'code'],
        ]],
    ];
}
