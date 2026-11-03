<?php
declare(strict_types=1);

/* ---------------------------------------------------------------
 * Database
 * ------------------------------------------------------------- */
function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        global $CONFIG;
        $c = $CONFIG['db'];
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], (int)($c['port'] ?? 3306), $c['name']);
        $pdo = new PDO($dsn, $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function q_one(string $sql, array $params = []): ?array
{
    $row = q($sql, $params)->fetch();
    return $row === false ? null : $row;
}

function q_val(string $sql, array $params = []): mixed
{
    $v = q($sql, $params)->fetchColumn();
    return $v === false ? null : $v;
}

function now_utc(): string
{
    return gmdate('Y-m-d H:i:s');
}

/* ---------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------- */
function default_settings(): array
{
    return [
        // General
        'site_name' => 'SignalPro',
        'tagline' => 'Binary & Forex trading signals',
        'logo_url' => '',
        'favicon_url' => '',
        'primary_color' => '#22c55e',
        'accent_color' => '#3b82f6',
        'admin_email' => '',
        'display_timezone' => 'UTC',
        'register_enabled' => '1',
        'show_ticker' => '1',
        'ticker_symbols' => "FX_IDC:EURUSD|EUR/USD\nFX_IDC:GBPUSD|GBP/USD\nFX_IDC:USDJPY|USD/JPY\nOANDA:XAUUSD|Gold\nBINANCE:BTCUSDT|BTC/USDT\nBINANCE:ETHUSDT|ETH/USDT",
        // Homepage
        'hero_title' => 'Smart Binary & Forex Signals, Delivered in Real Time',
        'hero_subtitle' => 'Our auto signal engine scans the market 24/7 using EMA, RSI, MACD and ATR analysis. Get free signals now, unlock premium high-confidence signals any time.',
        'hero_cta' => 'Get Free Signals',
        'home_html' => '',
        'disclaimer' => 'Risk warning: Trading binary options, forex and CFDs involves high risk and may not be suitable for all investors. You can lose some or all of your capital. Signals are technical-analysis based information, not financial advice, and past performance does not guarantee future results.',
        'footer_text' => '',
        'social_telegram' => '',
        'social_facebook' => '',
        'social_youtube' => '',
        'social_whatsapp' => '',
        // Signals engine
        'auto_enabled' => '1',
        'twelvedata_key' => '',
        'binary_assets' => "EUR/USD\nBTCUSDT\nETHUSDT",
        'binary_timeframe' => '5min',
        'binary_expiry' => '5',
        'forex_assets' => "EUR/USD\nXAU/USD",
        'forex_timeframe' => '15min',
        'forex_expiry_hours' => '24',
        'crypto_assets' => "BTCUSDT\nETHUSDT",
        'crypto_timeframe' => '15min',
        'min_confidence' => '65',
        'premium_confidence' => '78',
        'free_delay_minutes' => '0',
        'max_td_calls' => '7',
        'td_daily_limit' => '790',
        'cron_key' => '',
        'last_cron' => '',
        // Telegram
        'telegram_bot_token' => '',
        'telegram_free_chat' => '',
        'telegram_premium_chat' => '',
        'telegram_results' => '1',
        // Payments / premium
        'payment_methods' => "USDT (TRC20)\nbKash\nNagad\nBank transfer",
        'payment_instructions' => "Send the plan amount to one of these accounts, then submit the transaction ID below. Your premium is activated after we verify the payment (usually within 1 hour).\n\nUSDT (TRC20): YOUR-WALLET-ADDRESS\nbKash / Nagad: 01XXXXXXXXX",
        'referral_reward_days' => '7',
        // Email opt-in
        'optin_enabled' => '1',
        'optin_popup' => '1',
        'optin_popup_delay' => '15',
        'optin_title' => 'Get free signals in your inbox',
        'optin_text' => 'Join our list for free daily signals, market analysis and exclusive broker bonuses.',
        'optin_consent' => 'I agree to receive emails and can unsubscribe at any time.',
        // Custom code
        'head_code' => '',
        'body_start_code' => '',
        'footer_code' => '',
        'custom_css' => '',
        'custom_js' => '',
        'ad_top' => '',
        'ad_signals' => '',
        'ad_post' => '',
    ];
}

function settings_all(bool $reload = false): array
{
    static $cache = null;
    if ($cache === null || $reload) {
        $cache = default_settings();
        try {
            foreach (q('SELECT k, v FROM settings')->fetchAll() as $r) {
                $cache[$r['k']] = (string)$r['v'];
            }
        } catch (Throwable $e) {
            // table missing during install
        }
    }
    return $cache;
}

function setting(string $key, string $default = ''): string
{
    $all = settings_all();
    return array_key_exists($key, $all) ? (string)$all[$key] : $default;
}

function save_setting(string $key, string $value): void
{
    q('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [$key, $value]);
}

function lines(string $text): array
{
    return array_values(array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', $text) ?: [])));
}

/* ---------------------------------------------------------------
 * Output helpers
 * ------------------------------------------------------------- */
function e(mixed $v): string
{
    return htmlspecialchars((string)$v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function url(string $path = ''): string
{
    return BASE_URL . '/' . ltrim($path, '/');
}

function asset(string $path): string
{
    $file = APP_ROOT . '/assets/' . ltrim($path, '/');
    $v = is_file($file) ? (string)filemtime($file) : APP_VERSION;
    return url('assets/' . ltrim($path, '/')) . '?v=' . $v;
}

function redirect(string $to): never
{
    if (!preg_match('#^(https?://|/)#', $to)) {
        $to = url($to);
    }
    header('Location: ' . $to);
    exit;
}

function render(string $view, array $vars = [], string $layout = 'layout'): void
{
    extract($vars, EXTR_SKIP);
    ob_start();
    include APP_ROOT . '/views/' . $view . '.php';
    $content = ob_get_clean();
    if ($layout === '') {
        echo $content;
        return;
    }
    include APP_ROOT . '/views/' . $layout . '.php';
}

function json_out(mixed $data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function not_found(): never
{
    http_response_code(404);
    render('404', ['title' => 'Page not found']);
    exit;
}

function fmt_time(?string $utc, string $format = 'M j, Y H:i'): string
{
    if (!$utc) {
        return '—';
    }
    try {
        $tz = new DateTimeZone(setting('display_timezone', 'UTC') ?: 'UTC');
    } catch (Throwable $e) {
        $tz = new DateTimeZone('UTC');
    }
    $d = new DateTime($utc, new DateTimeZone('UTC'));
    $d->setTimezone($tz);
    return $d->format($format);
}

function iso_utc(?string $utc): string
{
    return $utc ? str_replace(' ', 'T', $utc) . 'Z' : '';
}

function fmt_price(mixed $v): string
{
    if ($v === null || $v === '') {
        return '—';
    }
    $f = (float)$v;
    $dec = $f >= 1000 ? 2 : ($f >= 10 ? 3 : 5);
    return number_format($f, $dec, '.', '');
}

function time_ago(string $utc): string
{
    $diff = time() - strtotime($utc . ' UTC');
    if ($diff < 60) return 'just now';
    if ($diff < 3600) return floor($diff / 60) . ' min ago';
    if ($diff < 86400) return floor($diff / 3600) . ' h ago';
    return floor($diff / 86400) . ' d ago';
}

function slugify(string $text): string
{
    $text = strtolower(trim($text));
    $text = preg_replace('/[^a-z0-9]+/u', '-', $text) ?? '';
    $text = trim($text, '-');
    return $text !== '' ? substr($text, 0, 180) : 'item-' . bin2hex(random_bytes(3));
}

function excerpt(string $html, int $len = 160): string
{
    $t = trim(preg_replace('/\s+/', ' ', strip_tags(str_replace('<', ' <', $html))) ?? '');
    return mb_strlen($t) > $len ? mb_substr($t, 0, $len) . '…' : $t;
}

/* ---------------------------------------------------------------
 * Sessions, CSRF, flash
 * ------------------------------------------------------------- */
function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
        || (($_SERVER['SERVER_PORT'] ?? '') == 443);
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $path = parse_url(BASE_URL, PHP_URL_PATH) ?: '/';
    session_name('sigsess');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => rtrim($path, '/') . '/',
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 30));
    session_start();
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="_csrf" value="' . e(csrf_token()) . '">';
}

function csrf_check(): void
{
    $t = $_POST['_csrf'] ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if (!is_string($t) || !hash_equals(csrf_token(), $t)) {
        http_response_code(419);
        exit('Security token expired. Please go back, refresh the page and try again.');
    }
}

function is_post(): bool
{
    return ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
}

function flash(string $type, string $msg): void
{
    $_SESSION['flash'][] = ['type' => $type, 'msg' => $msg];
}

function flashes(): array
{
    $f = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return $f;
}

function old(string $key, string $default = ''): string
{
    return isset($_POST[$key]) && is_string($_POST[$key]) ? $_POST[$key] : $default;
}

function post_str(string $key, int $max = 10000): string
{
    $v = $_POST[$key] ?? '';
    return is_string($v) ? mb_substr(trim($v), 0, $max) : '';
}

function client_ip(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 45);
}

/* ---------------------------------------------------------------
 * Auth
 * ------------------------------------------------------------- */
function current_user(): ?array
{
    static $user = false;
    if ($user === false) {
        $user = null;
        if (!empty($_SESSION['uid'])) {
            $user = q_one("SELECT * FROM users WHERE id = ? AND status = 'active'", [(int)$_SESSION['uid']]);
            if (!$user) {
                unset($_SESSION['uid']);
            }
        }
    }
    return $user;
}

function is_admin(): bool
{
    $u = current_user();
    return $u !== null && $u['role'] === 'admin';
}

function user_is_premium(?array $u = null): bool
{
    $u = $u ?? current_user();
    if (!$u) {
        return false;
    }
    if ($u['role'] === 'admin') {
        return true;
    }
    return !empty($u['premium_until']) && strtotime($u['premium_until'] . ' UTC') > time();
}

function login_user(array $u): void
{
    session_regenerate_id(true);
    $_SESSION['uid'] = (int)$u['id'];
    q('UPDATE users SET last_login = ? WHERE id = ?', [now_utc(), $u['id']]);
}

function require_login(): array
{
    $u = current_user();
    if (!$u) {
        flash('info', 'Please log in first.');
        redirect('login?next=' . rawurlencode($_SERVER['REQUEST_URI'] ?? ''));
    }
    return $u;
}

function too_many_attempts(string $ip): bool
{
    q('DELETE FROM login_attempts WHERE created_at < ?', [gmdate('Y-m-d H:i:s', time() - 3600)]);
    $n = (int)q_val('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND created_at > ?', [$ip, gmdate('Y-m-d H:i:s', time() - 900)]);
    return $n >= 10;
}

function record_attempt(string $ip): void
{
    q('INSERT INTO login_attempts (ip) VALUES (?)', [$ip]);
}

function new_ref_code(): string
{
    do {
        $code = strtoupper(substr(bin2hex(random_bytes(5)), 0, 8));
    } while (q_val('SELECT id FROM users WHERE ref_code = ?', [$code]));
    return $code;
}

function safe_next(string $next): string
{
    // Only allow local redirects
    if ($next === '' || !str_starts_with($next, '/') || str_starts_with($next, '//')) {
        return url('dashboard');
    }
    return $next;
}

/* ---------------------------------------------------------------
 * Subscribers (email opt-in)
 * ------------------------------------------------------------- */
function add_subscriber(string $email, string $name, string $source): bool
{
    $email = strtolower(trim($email));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    $existing = q_one('SELECT id, status FROM subscribers WHERE email = ?', [$email]);
    if ($existing) {
        q("UPDATE subscribers SET status = 'subscribed', name = COALESCE(NULLIF(?, ''), name) WHERE id = ?", [$name, $existing['id']]);
        return true;
    }
    q('INSERT INTO subscribers (email, name, source, consent_text, ip, token) VALUES (?, ?, ?, ?, ?, ?)', [
        $email, $name ?: null, substr($source, 0, 60), mb_substr(setting('optin_consent'), 0, 500), client_ip(), bin2hex(random_bytes(16)),
    ]);
    return true;
}

/* ---------------------------------------------------------------
 * Signals helpers
 * ------------------------------------------------------------- */
function signal_label(array $s): string
{
    if ($s['market'] === 'binary') {
        return $s['direction'] === 'BUY' ? 'CALL' : 'PUT';
    }
    return $s['direction'];
}

function tv_symbol(string $asset): string
{
    $a = strtoupper(trim($asset));
    if (str_contains($a, ':')) {
        return $a;
    }
    if (str_contains($a, '/')) {
        $p = str_replace('/', '', $a);
        return in_array(substr($p, 0, 3), ['XAU', 'XAG'], true) ? 'OANDA:' . $p : 'FX_IDC:' . $p;
    }
    return 'BINANCE:' . $a;
}

/** Can the given viewer see full details of this signal? */
function can_view_signal(array $s, ?array $u): bool
{
    if (user_is_premium($u)) {
        return true;
    }
    if ((int)$s['is_premium'] === 1 && $s['status'] === 'active') {
        return false;
    }
    $delay = (int)setting('free_delay_minutes', '0');
    if ($delay > 0 && $s['status'] === 'active') {
        return strtotime($s['created_at'] . ' UTC') + $delay * 60 <= time();
    }
    return true;
}

function signal_stats(int $days = 30, ?string $market = null): array
{
    $params = [gmdate('Y-m-d H:i:s', time() - $days * 86400)];
    $where = "created_at >= ? AND status IN ('win','loss')";
    if ($market) {
        $where .= ' AND market = ?';
        $params[] = $market;
    }
    $row = q_one("SELECT SUM(status='win') wins, SUM(status='loss') losses FROM signals WHERE $where", $params) ?? [];
    $w = (int)($row['wins'] ?? 0);
    $l = (int)($row['losses'] ?? 0);
    return ['wins' => $w, 'losses' => $l, 'total' => $w + $l, 'rate' => ($w + $l) > 0 ? round($w / ($w + $l) * 100, 1) : 0];
}

function pagination(int $total, int $perPage, int $page, string $baseUrl): string
{
    $pages = (int)ceil($total / max(1, $perPage));
    if ($pages <= 1) {
        return '';
    }
    $sep = str_contains($baseUrl, '?') ? '&' : '?';
    $html = '<nav class="pagination">';
    for ($i = 1; $i <= $pages; $i++) {
        if ($pages > 10 && abs($i - $page) > 3 && $i !== 1 && $i !== $pages) {
            if (abs($i - $page) === 4) $html .= '<span>…</span>';
            continue;
        }
        $html .= $i === $page ? '<span class="active">' . $i . '</span>' : '<a href="' . e($baseUrl . $sep . 'page=' . $i) . '">' . $i . '</a>';
    }
    return $html . '</nav>';
}

function current_page(): int
{
    return max(1, (int)($_GET['page'] ?? 1));
}

function menu_pages(string $where = 'in_menu'): array
{
    $col = $where === 'in_footer' ? 'in_footer' : 'in_menu';
    try {
        return q("SELECT title, slug FROM pages WHERE status = 'published' AND $col = 1 ORDER BY sort_order, id")->fetchAll();
    } catch (Throwable $e) {
        return [];
    }
}

function send_mail(string $to, string $subject, string $body): bool
{
    $from = setting('admin_email') ?: ('no-reply@' . (parse_url(BASE_URL, PHP_URL_HOST) ?: 'localhost'));
    $headers = 'From: ' . setting('site_name') . ' <' . $from . ">\r\n" .
        "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n";
    return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers);
}
