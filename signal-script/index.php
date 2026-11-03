<?php
declare(strict_types=1);

require __DIR__ . '/inc/bootstrap.php';

/* ---------- route parsing ---------- */
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$basePath = rtrim(parse_url(BASE_URL, PHP_URL_PATH) ?: '', '/');
if ($basePath !== '' && str_starts_with($path, $basePath)) {
    $path = substr($path, strlen($basePath));
}
$path = trim(rawurldecode($path), '/');
if ($path === 'index.php') {
    $path = '';
}
// Fallback for servers without mod_rewrite: index.php?r=signals
if ($path === '' && isset($_GET['r']) && is_string($_GET['r'])) {
    $path = trim($_GET['r'], '/');
}
$seg = $path === '' ? [] : explode('/', $path);
$route = $seg[0] ?? '';

/* ---------- referral capture ---------- */
if (isset($_GET['ref']) && is_string($_GET['ref']) && preg_match('/^[A-Z0-9]{6,16}$/', strtoupper($_GET['ref']))) {
    setcookie('ref', strtoupper($_GET['ref']), [
        'expires' => time() + 60 * 86400, 'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax',
    ]);
}

$user = current_user();

if (setting('maintenance_mode') === '1' && !is_admin() && !in_array($route, ['login', 'ipn', 'manifest.webmanifest', 'robots.txt'], true)) {
    http_response_code(503);
    header('Retry-After: 1800');
    render('maintenance', ['title' => 'Maintenance'], '');
    exit;
}

function active_list(string $table): array
{
    try {
        return q("SELECT * FROM `$table` WHERE active = 1 ORDER BY sort_order, id")->fetchAll();
    } catch (Throwable $e) {
        return [];
    }
}

switch ($route) {
    /* ================= HOME ================= */
    case '':
        $active = q("SELECT * FROM signals WHERE status = 'active' ORDER BY created_at DESC LIMIT 6")->fetchAll();
        $recent = q("SELECT * FROM signals WHERE status IN ('win','loss') ORDER BY closed_at DESC LIMIT 8")->fetchAll();
        render('home', [
            'title' => setting('site_name') . ' — ' . setting('tagline'),
            'active' => $active,
            'recent' => $recent,
            'stats' => signal_stats(30),
            'statsBinary' => signal_stats(30, 'binary'),
            'statsForex' => signal_stats(30, 'forex'),
            'brokers' => q('SELECT * FROM brokers WHERE active = 1 ORDER BY featured DESC, sort_order, id LIMIT 3')->fetchAll(),
            'posts' => q("SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC LIMIT 3")->fetchAll(),
            'plans' => q('SELECT * FROM plans WHERE active = 1 ORDER BY sort_order, price LIMIT 3')->fetchAll(),
            'testimonials' => active_list('testimonials'),
            'faqs' => array_slice(active_list('faqs'), 0, 6),
            'series' => performance_series(14),
        ]);
        break;

    /* ================= SIGNALS ================= */
    case 'signals':
        $market = in_array($_GET['market'] ?? '', ['binary', 'forex', 'crypto'], true) ? $_GET['market'] : '';
        $where = "status = 'active'";
        $params = [];
        if ($market) {
            $where .= ' AND market = ?';
            $params[] = $market;
        }
        render('signals', [
            'title' => 'Live Signals',
            'market' => $market,
            'signals' => q("SELECT * FROM signals WHERE $where ORDER BY created_at DESC LIMIT 60", $params)->fetchAll(),
            'brokers' => q('SELECT * FROM brokers WHERE active = 1 ORDER BY featured DESC, sort_order, id LIMIT 2')->fetchAll(),
            'maxId' => (int)q_val('SELECT COALESCE(MAX(id),0) FROM signals'),
        ]);
        break;

    case 'signal':
        $s = q_one('SELECT * FROM signals WHERE id = ?', [(int)($seg[1] ?? 0)]);
        if (!$s) not_found();
        $canView = can_view_signal($s, $user);
        render('signal', [
            'title' => $canView ? $s['asset'] . ' ' . signal_label($s) . ' signal' : 'Premium ' . $s['market'] . ' signal',
            's' => $s,
            'canView' => $canView,
            'journal' => $user ? q_one('SELECT * FROM journal WHERE user_id = ? AND signal_id = ?', [$user['id'], $s['id']]) : null,
            'brokers' => q('SELECT * FROM brokers WHERE active = 1 ORDER BY featured DESC, sort_order, id LIMIT 3')->fetchAll(),
        ]);
        break;

    case 'results':
        $page = current_page();
        $per = 30;
        $market = in_array($_GET['market'] ?? '', ['binary', 'forex', 'crypto'], true) ? $_GET['market'] : '';
        $where = "status IN ('win','loss','expired')";
        $params = [];
        if ($market) {
            $where .= ' AND market = ?';
            $params[] = $market;
        }
        $total = (int)q_val("SELECT COUNT(*) FROM signals WHERE $where", $params);
        render('results', [
            'title' => 'Signal Results & Performance',
            'market' => $market,
            'rows' => q("SELECT * FROM signals WHERE $where ORDER BY closed_at DESC LIMIT $per OFFSET " . (($page - 1) * $per), $params)->fetchAll(),
            'stats7' => signal_stats(7, $market ?: null),
            'stats30' => signal_stats(30, $market ?: null),
            'statsAll' => signal_stats(3650, $market ?: null),
            'pager' => pagination($total, $per, $page, url('results') . ($market ? '?market=' . $market : '')),
            'series' => performance_series(30, $market ?: null),
            'perAsset' => q("SELECT asset, market, SUM(status='win') w, SUM(status='loss') l FROM signals WHERE status IN ('win','loss')" . ($market ? ' AND market = ?' : '') . " GROUP BY asset, market ORDER BY COUNT(*) DESC LIMIT 12", $market ? [$market] : [])->fetchAll(),
            'streak' => (function () use ($market) {
                $rows = q("SELECT status FROM signals WHERE status IN ('win','loss')" . ($market ? ' AND market = ?' : '') . ' ORDER BY closed_at DESC LIMIT 200', $market ? [$market] : [])->fetchAll(PDO::FETCH_COLUMN);
                $cur = 0; $best = 0; $run = 0;
                foreach ($rows as $i => $st) { if ($i === $cur && $st === 'win') $cur++; }
                foreach (array_reverse($rows) as $st) { $run = $st === 'win' ? $run + 1 : 0; $best = max($best, $run); }
                return ['current' => $cur, 'best' => $best];
            })(),
        ]);
        break;

    case 'tools':
        render('tools', ['title' => 'Trading Calculators', 'metaDescription' => 'Free lot size, pip value, risk/reward, binary options profit and compounding calculators.']);
        break;

    case 'markets':
        render('markets', ['title' => 'Markets, Heatmap & Economic Calendar', 'metaDescription' => 'Live forex heatmap, economic calendar, technical analysis gauges and market overview.']);
        break;

    case 'journal':
        $u = require_login();
        if (is_post()) {
            csrf_check();
            $sid = (int)($_POST['signal_id'] ?? 0);
            if (($_POST['do'] ?? '') === 'remove') {
                q('DELETE FROM journal WHERE user_id = ? AND (signal_id = ? OR id = ?)', [$u['id'], $sid, (int)($_POST['id'] ?? 0)]);
                flash('success', 'Removed from your journal.');
            } else {
                $sig = q_one('SELECT * FROM signals WHERE id = ?', [$sid]);
                if ($sig && can_view_signal($sig, $u)) {
                    $stake = max(0.01, min(1000000, (float)str_replace(',', '.', (string)($_POST['stake'] ?? '10'))));
                    $payout = max(1, min(100, (int)($_POST['payout'] ?? setting('journal_payout', '85'))));
                    q('INSERT INTO journal (user_id, signal_id, stake, payout_pct, note) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE stake = VALUES(stake), payout_pct = VALUES(payout_pct), note = VALUES(note)', [$u['id'], $sid, $stake, $payout, post_str('note', 500) ?: null]);
                    flash('success', 'Trade saved to your journal. Result updates automatically.');
                }
            }
            $back = (string)($_POST['back'] ?? '');
            redirect($back !== '' && str_starts_with($back, '/') && !str_starts_with($back, '//') ? $back : url('dashboard'));
        }
        redirect('dashboard#journal');

    case 'ipn':
        if (($seg[1] ?? '') !== 'nowpayments' || !nowpayments_enabled()) json_out(['error' => 'disabled'], 404);
        $body = (string)file_get_contents('php://input');
        $data = nowpayments_verify($body, (string)($_SERVER['HTTP_X_NOWPAYMENTS_SIG'] ?? ''));
        if (!$data) json_out(['error' => 'bad signature'], 401);
        $pid = (int)ltrim((string)($data['order_id'] ?? ''), 'P');
        $pay = q_one('SELECT * FROM payments WHERE id = ?', [$pid]);
        $status = (string)($data['payment_status'] ?? '');
        if ($pay) {
            q('UPDATE payments SET txn_id = ?, note = ? WHERE id = ?', [mb_substr((string)($data['payment_id'] ?? $pay['txn_id']), 0, 190), 'NOWPayments: ' . $status . ' · ' . ($data['pay_amount'] ?? '') . ' ' . strtoupper((string)($data['pay_currency'] ?? '')), $pid]);
            if (in_array($status, ['finished', 'confirmed'], true)) {
                approve_payment($pay);
            } elseif (in_array($status, ['failed', 'expired', 'refunded'], true) && $pay['status'] === 'pending') {
                q("UPDATE payments SET status = 'rejected', reviewed_at = ? WHERE id = ?", [now_utc(), $pid]);
            }
        }
        json_out(['ok' => true]);

    case 'manifest.webmanifest':
        header('Content-Type: application/manifest+json');
        echo json_encode([
            'name' => setting('site_name'),
            'short_name' => mb_substr(setting('site_name'), 0, 12),
            'description' => setting('tagline'),
            'start_url' => url('signals'),
            'scope' => url(),
            'display' => 'standalone',
            'background_color' => '#070b14',
            'theme_color' => '#070b14',
            'icons' => [
                ['src' => setting('favicon_url') ?: asset('img/icon.svg'), 'sizes' => 'any', 'type' => setting('favicon_url') ? 'image/png' : 'image/svg+xml', 'purpose' => 'any maskable'],
            ],
        ], JSON_UNESCAPED_SLASHES);
        exit;

    case 'api':
        if (($seg[1] ?? '') === 'signals') {
            $since = (int)($_GET['since'] ?? 0);
            $rows = q("SELECT id, market, asset, direction, is_premium, confidence, created_at FROM signals WHERE id > ? AND status = 'active' ORDER BY id DESC LIMIT 20", [$since])->fetchAll();
            $premium = user_is_premium($user);
            $out = array_map(fn($r) => [
                'id' => (int)$r['id'],
                'market' => $r['market'],
                'asset' => ((int)$r['is_premium'] && !$premium) ? 'Premium signal' : $r['asset'],
                'label' => ((int)$r['is_premium'] && !$premium) ? '🔒' : signal_label($r),
                'premium' => (bool)$r['is_premium'],
            ], $rows);
            json_out(['signals' => $out, 'maxId' => (int)q_val('SELECT COALESCE(MAX(id),0) FROM signals')]);
        }
        json_out(['error' => 'not found'], 404);

    /* ================= CONTENT ================= */
    case 'blog':
        if (!empty($seg[1])) {
            $post = q_one("SELECT * FROM posts WHERE slug = ? AND status = 'published'", [$seg[1]]);
            if (!$post && is_admin()) {
                $post = q_one('SELECT * FROM posts WHERE slug = ?', [$seg[1]]);
            }
            if (!$post) not_found();
            q('UPDATE posts SET views = views + 1 WHERE id = ?', [$post['id']]);
            render('post', [
                'title' => $post['title'],
                'metaDescription' => $post['meta_description'] ?: excerpt((string)$post['excerpt'] ?: ((int)$post['is_premium'] ? (string)$post['title'] : (string)$post['content'])),
                'ogImage' => $post['image_url'],
                'post' => $post,
                'locked' => (int)$post['is_premium'] && !user_is_premium($user),
                'related' => q("SELECT title, slug, image_url, created_at FROM posts WHERE status = 'published' AND id <> ? ORDER BY created_at DESC LIMIT 3", [$post['id']])->fetchAll(),
            ]);
            break;
        }
        $page = current_page();
        $per = 9;
        $cat = isset($_GET['cat']) && is_string($_GET['cat']) ? mb_substr($_GET['cat'], 0, 80) : '';
        $where = "status = 'published'";
        $params = [];
        if ($cat !== '') {
            $where .= ' AND category = ?';
            $params[] = $cat;
        }
        $total = (int)q_val("SELECT COUNT(*) FROM posts WHERE $where", $params);
        render('blog', [
            'title' => 'Market Analysis & Blog',
            'posts' => q("SELECT * FROM posts WHERE $where ORDER BY created_at DESC LIMIT $per OFFSET " . (($page - 1) * $per), $params)->fetchAll(),
            'cats' => q("SELECT category, COUNT(*) n FROM posts WHERE status = 'published' AND category IS NOT NULL AND category <> '' GROUP BY category ORDER BY n DESC")->fetchAll(),
            'cat' => $cat,
            'pager' => pagination($total, $per, $page, url('blog') . ($cat ? '?cat=' . rawurlencode($cat) : '')),
        ]);
        break;

    case 'p':
        $pg = q_one("SELECT * FROM pages WHERE slug = ? AND status = 'published'", [$seg[1] ?? '']);
        if (!$pg && is_admin()) {
            $pg = q_one('SELECT * FROM pages WHERE slug = ?', [$seg[1] ?? '']);
        }
        if (!$pg) not_found();
        if ((int)$pg['bare']) {
            // Full custom HTML page, no theme
            echo $pg['content'];
            break;
        }
        render('page', ['title' => $pg['title'], 'metaDescription' => $pg['meta_description'], 'pg' => $pg]);
        break;

    /* ================= AFFILIATE ================= */
    case 'brokers':
        render('brokers', [
            'title' => 'Recommended Brokers',
            'brokers' => q('SELECT * FROM brokers WHERE active = 1 ORDER BY featured DESC, sort_order, id')->fetchAll(),
        ]);
        break;

    case 'go':
        $b = q_one('SELECT * FROM brokers WHERE id = ? AND active = 1', [(int)($seg[1] ?? 0)]);
        if (!$b) not_found();
        q('UPDATE brokers SET clicks = clicks + 1 WHERE id = ?', [$b['id']]);
        q('INSERT INTO clicks (broker_id, user_id, ip_hash, referer) VALUES (?, ?, ?, ?)', [
            $b['id'], $user['id'] ?? null, hash('sha256', client_ip() . BASE_URL), mb_substr((string)($_SERVER['HTTP_REFERER'] ?? ''), 0, 500),
        ]);
        header('X-Robots-Tag: noindex, nofollow');
        header('Location: ' . $b['affiliate_url'], true, 302);
        exit;

    /* ================= PREMIUM ================= */
    case 'pricing':
        render('pricing', [
            'title' => 'Premium Plans',
            'testimonials' => active_list('testimonials'),
            'faqs' => active_list('faqs'),
            'plans' => q('SELECT * FROM plans WHERE active = 1 ORDER BY sort_order, price')->fetchAll(),
        ]);
        break;

    case 'upgrade':
        $u = require_login();
        $plan = q_one('SELECT * FROM plans WHERE id = ? AND active = 1', [(int)($seg[1] ?? ($_POST['plan_id'] ?? 0))]);
        if (!$plan) {
            redirect('pricing');
        }
        $code = strtoupper(trim((string)($_POST['coupon'] ?? ($_GET['coupon'] ?? ''))));
        ['coupon' => $coupon, 'error' => $couponError] = find_coupon($code);
        $price = plan_price($plan, $coupon);
        if (is_post()) {
            csrf_check();
            $pendingCount = (int)q_val("SELECT COUNT(*) FROM payments WHERE user_id = ? AND status = 'pending' AND created_at > ?", [$u['id'], gmdate('Y-m-d H:i:s', time() - 86400)]);
            $action = $_POST['action'] ?? 'manual';
            if ($pendingCount >= 5) {
                flash('error', 'You already have several pending payments. Please wait for review or contact support.');
            } elseif ($action === 'crypto' && nowpayments_enabled()) {
                q("INSERT INTO payments (user_id, plan_id, amount, original_amount, coupon_code, currency, method, txn_id, gateway) VALUES (?,?,?,?,?,?,?,?, 'nowpayments')", [
                    $u['id'], $plan['id'], $price, $plan['price'], $coupon['code'] ?? null, $plan['currency'], 'Crypto (NOWPayments)', 'pending-' . bin2hex(random_bytes(4)),
                ]);
                $pid = (int)db()->lastInsertId();
                $invoice = nowpayments_invoice($pid, $price, $plan['currency'], setting('site_name') . ' ' . $plan['name'] . ' plan');
                if ($invoice) {
                    redirect($invoice);
                }
                q('DELETE FROM payments WHERE id = ?', [$pid]);
                flash('error', 'Crypto checkout is temporarily unavailable. Please use manual payment below.');
            } else {
                $method = post_str('method', 60);
                $txn = post_str('txn_id', 190);
                if ($method === '' || $txn === '') {
                    flash('error', 'Please choose a payment method and enter your transaction ID.');
                } elseif (q_val('SELECT id FROM payments WHERE txn_id = ?', [$txn])) {
                    flash('error', 'This transaction ID was already submitted.');
                } else {
                    q('INSERT INTO payments (user_id, plan_id, amount, original_amount, coupon_code, currency, method, txn_id, note) VALUES (?,?,?,?,?,?,?,?,?)', [
                        $u['id'], $plan['id'], $price, $plan['price'], $coupon['code'] ?? null, $plan['currency'], $method, $txn, post_str('note', 1000),
                    ]);
                    if (setting('admin_email')) {
                        send_mail(setting('admin_email'), 'New payment to review', "User: {$u['email']}\nPlan: {$plan['name']}\nAmount: $price {$plan['currency']}" . ($coupon ? " (coupon {$coupon['code']})" : '') . "\nMethod: $method\nTXN: $txn\n\n" . url('admin/?a=payments'));
                    }
                    flash('success', 'Payment submitted! Your premium will be activated after verification.');
                    redirect('dashboard');
                }
            }
        }
        render('upgrade', ['title' => 'Upgrade to ' . $plan['name'], 'plan' => $plan, 'coupon' => $coupon, 'couponError' => $couponError, 'code' => $code, 'price' => $price]);
        break;

    /* ================= ACCOUNT ================= */
    case 'register':
        if ($user) redirect('dashboard');
        if (setting('register_enabled') !== '1') {
            flash('error', 'Registration is currently closed.');
            redirect('login');
        }
        if (is_post()) {
            csrf_check();
            $name = post_str('name', 120);
            $email = strtolower(post_str('email', 190));
            $pass = (string)($_POST['password'] ?? '');
            $optin = !empty($_POST['optin']);
            $err = null;
            if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) $err = 'Please enter your name and a valid email.';
            elseif (strlen($pass) < 8) $err = 'Password must be at least 8 characters.';
            elseif (q_val('SELECT id FROM users WHERE email = ?', [$email])) $err = 'An account with this email already exists.';
            elseif (!empty($_POST['website'])) $err = 'Spam detected.'; // honeypot
            if ($err) {
                flash('error', $err);
            } else {
                $refBy = null;
                if (!empty($_COOKIE['ref'])) {
                    $refBy = q_val('SELECT id FROM users WHERE ref_code = ?', [strtoupper((string)$_COOKIE['ref'])]);
                }
                q('INSERT INTO users (name, email, password_hash, ref_code, referred_by, marketing_optin) VALUES (?,?,?,?,?,?)', [
                    $name, $email, password_hash($pass, PASSWORD_DEFAULT), new_ref_code(), $refBy ?: null, $optin ? 1 : 0,
                ]);
                if ($optin) {
                    add_subscriber($email, $name, 'register');
                }
                login_user(q_one('SELECT * FROM users WHERE email = ?', [$email]));
                flash('success', 'Welcome! Your free account is ready.');
                redirect('dashboard');
            }
        }
        render('auth', ['title' => 'Create account', 'mode' => 'register']);
        break;

    case 'login':
        if ($user) redirect('dashboard');
        if (is_post()) {
            csrf_check();
            $ip = client_ip();
            if (too_many_attempts($ip)) {
                flash('error', 'Too many attempts. Please wait 15 minutes.');
            } else {
                $u = q_one('SELECT * FROM users WHERE email = ?', [strtolower(post_str('email', 190))]);
                if ($u && password_verify((string)($_POST['password'] ?? ''), $u['password_hash'])) {
                    if ($u['status'] !== 'active') {
                        flash('error', 'This account is suspended.');
                    } else {
                        if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
                            q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string)$_POST['password'], PASSWORD_DEFAULT), $u['id']]);
                        }
                        login_user($u);
                        $next = (string)($_POST['next'] ?? '');
                        if ($next === '' && $u['role'] === 'admin') {
                            redirect('admin/');
                        }
                        redirect(safe_next($next));
                    }
                } else {
                    record_attempt($ip);
                    flash('error', 'Wrong email or password.');
                }
            }
        }
        render('auth', ['title' => 'Log in', 'mode' => 'login']);
        break;

    case 'logout':
        if (is_post()) {
            csrf_check();
            $_SESSION = [];
            session_destroy();
        }
        redirect('');

    case 'forgot':
        if (is_post()) {
            csrf_check();
            $u = q_one('SELECT * FROM users WHERE email = ?', [strtolower(post_str('email', 190))]);
            if ($u && !too_many_attempts(client_ip())) {
                record_attempt(client_ip());
                $token = bin2hex(random_bytes(24));
                q('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?', [hash('sha256', $token), gmdate('Y-m-d H:i:s', time() + 3600), $u['id']]);
                send_mail($u['email'], 'Reset your password', "Hi {$u['name']},\n\nReset your password here (valid for 1 hour):\n" . url('reset/' . $token) . "\n\nIf you didn't request this, ignore this email.");
            }
            flash('success', 'If that email exists, we sent a reset link.');
            redirect('login');
        }
        render('auth', ['title' => 'Forgot password', 'mode' => 'forgot']);
        break;

    case 'reset':
        $token = (string)($seg[1] ?? '');
        $u = $token !== '' ? q_one('SELECT * FROM users WHERE reset_token = ? AND reset_expires > ?', [hash('sha256', $token), now_utc()]) : null;
        if (!$u) {
            flash('error', 'This reset link is invalid or expired.');
            redirect('forgot');
        }
        if (is_post()) {
            csrf_check();
            $pass = (string)($_POST['password'] ?? '');
            if (strlen($pass) < 8) {
                flash('error', 'Password must be at least 8 characters.');
            } else {
                q('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?', [password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
                flash('success', 'Password updated. Please log in.');
                redirect('login');
            }
        }
        render('auth', ['title' => 'Choose a new password', 'mode' => 'reset']);
        break;

    case 'dashboard':
        $u = require_login();
        if (is_post()) {
            csrf_check();
            $action = $_POST['action'] ?? '';
            if ($action === 'profile') {
                $optin = !empty($_POST['optin']);
                q('UPDATE users SET name = ?, marketing_optin = ? WHERE id = ?', [post_str('name', 120) ?: $u['name'], $optin ? 1 : 0, $u['id']]);
                if ($optin) add_subscriber($u['email'], $u['name'], 'dashboard');
                else q("UPDATE subscribers SET status = 'unsubscribed' WHERE email = ?", [$u['email']]);
                flash('success', 'Profile saved.');
            } elseif ($action === 'password') {
                if (!password_verify((string)($_POST['current'] ?? ''), $u['password_hash'])) flash('error', 'Current password is wrong.');
                elseif (strlen((string)($_POST['password'] ?? '')) < 8) flash('error', 'New password must be at least 8 characters.');
                else {
                    q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string)$_POST['password'], PASSWORD_DEFAULT), $u['id']]);
                    flash('success', 'Password changed.');
                }
            }
            redirect('dashboard');
        }
        render('dashboard', [
            'title' => 'My Dashboard',
            'u' => $u,
            'payments' => q('SELECT p.*, pl.name plan_name FROM payments p LEFT JOIN plans pl ON pl.id = p.plan_id WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 20', [$u['id']])->fetchAll(),
            'referrals' => (int)q_val('SELECT COUNT(*) FROM users WHERE referred_by = ?', [$u['id']]),
            'signals' => q("SELECT * FROM signals WHERE status = 'active' ORDER BY created_at DESC LIMIT 6")->fetchAll(),
            'journal' => journal_stats((int)$u['id']),
        ]);
        break;

    /* ================= EMAIL OPT-IN ================= */
    case 'subscribe':
        if (!is_post()) redirect('');
        csrf_check();
        $ajax = ($_SERVER['HTTP_ACCEPT'] ?? '') === 'application/json';
        $ok = empty($_POST['website']) && !empty($_POST['consent']) && add_subscriber(post_str('email', 190), post_str('name', 120), post_str('source', 60) ?: 'form');
        $msg = $ok ? 'Thanks! You are subscribed.' : 'Please enter a valid email and tick the consent box.';
        if ($ajax) json_out(['ok' => $ok, 'message' => $msg], $ok ? 200 : 422);
        flash($ok ? 'success' : 'error', $msg);
        redirect(safe_next((string)($_SERVER['HTTP_REFERER'] ?? '') !== '' ? (parse_url((string)$_SERVER['HTTP_REFERER'], PHP_URL_PATH) ?: '/') : '/'));

    case 'unsubscribe':
        $sub = q_one('SELECT * FROM subscribers WHERE token = ?', [(string)($seg[1] ?? '')]);
        if ($sub && is_post()) {
            csrf_check();
            q("UPDATE subscribers SET status = 'unsubscribed' WHERE id = ?", [$sub['id']]);
            q('UPDATE users SET marketing_optin = 0 WHERE email = ?', [$sub['email']]);
            $sub['status'] = 'unsubscribed';
        }
        render('unsubscribe', ['title' => 'Unsubscribe', 'sub' => $sub]);
        break;

    case 'sitemap.xml':
        header('Content-Type: application/xml; charset=utf-8');
        echo '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
        foreach (['', 'signals', 'results', 'markets', 'tools', 'blog', 'brokers', 'pricing'] as $p) {
            echo '<url><loc>' . e(url($p)) . '</loc></url>';
        }
        foreach (q("SELECT slug, COALESCE(updated_at, created_at) d FROM posts WHERE status = 'published'")->fetchAll() as $p) {
            echo '<url><loc>' . e(url('blog/' . $p['slug'])) . '</loc><lastmod>' . substr($p['d'], 0, 10) . '</lastmod></url>';
        }
        foreach (q("SELECT slug FROM pages WHERE status = 'published'")->fetchAll() as $p) {
            echo '<url><loc>' . e(url('p/' . $p['slug'])) . '</loc></url>';
        }
        echo '</urlset>';
        exit;

    case 'robots.txt':
        header('Content-Type: text/plain');
        echo "User-agent: *\nDisallow: /admin/\nDisallow: /go/\nSitemap: " . url('sitemap.xml') . "\n";
        exit;

    default:
        not_found();
}
