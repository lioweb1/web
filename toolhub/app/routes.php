<?php
declare(strict_types=1);

function request_path(): string
{
    $path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $basePath = rtrim((string) parse_url(base_url(), PHP_URL_PATH), '/');
    if ($basePath !== '' && str_starts_with($path, $basePath)) {
        $path = substr($path, strlen($basePath));
    }
    return trim($path, '/');
}

function dispatch(): void
{
    $path   = request_path();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $seg    = $path === '' ? [] : explode('/', $path);

    // Gateway callbacks come from other websites: no CSRF token, verified by the gateway itself.
    if (($seg[0] ?? '') === 'pay' && count($seg) === 3) {
        if ($seg[2] === 'webhook' && $method === 'POST') {
            gateway_webhook($seg[1]);
        }
        if ($seg[2] === 'return') {
            page_gateway_return($seg[1]);
        }
        not_found();
    }

    if ($method === 'POST') {
        verify_csrf();
    }

    match (true) {
        $path === ''                         => page_home(),
        $path === 'login'                    => page_login(),
        $path === 'register'                 => page_register(),
        $path === 'logout' && $method === 'POST' => page_logout(),
        $path === 'forgot-password'          => page_forgot(),
        $path === 'reset-password'           => page_reset(),
        $path === 'dashboard'                => page_dashboard(),
        $path === 'tools'                    => page_tools(),
        ($seg[0] ?? '') === 'tools' && count($seg) === 2 => page_tool($seg[1]),
        ($seg[0] ?? '') === 'tools' && count($seg) === 3 && $seg[2] === 'pin' && $method === 'POST' => page_tool_pin($seg[1]),
        $path === 'plans'                    => page_plans(),
        ($seg[0] ?? '') === 'checkout' && count($seg) === 2 => page_checkout((int) $seg[1]),
        $path === 'orders'                   => page_orders(),
        ($seg[0] ?? '') === 'orders' && count($seg) === 2 => page_order((int) $seg[1]),
        $path === 'history'                  => page_history(),
        ($seg[0] ?? '') === 'history' && count($seg) === 2 => page_history_item((int) $seg[1]),
        $path === 'account'                  => page_account(),
        $path === 'admin'                    => admin_dashboard(),
        $path === 'admin/payments'           => admin_payments(),
        $path === 'admin/users'              => admin_users(),
        ($seg[0] ?? '') === 'admin' && ($seg[1] ?? '') === 'users' && count($seg) === 3 => admin_user((int) $seg[2]),
        $path === 'admin/tools'              => admin_tools(),
        ($seg[0] ?? '') === 'admin' && ($seg[1] ?? '') === 'tools' && count($seg) === 3 => admin_tool_edit($seg[2]),
        $path === 'admin/packages'           => admin_packages(),
        $path === 'admin/methods'            => admin_methods(),
        default                              => not_found(),
    };
}

// ---------------------------------------------------------------------------
// Public & auth pages
// ---------------------------------------------------------------------------

function page_home(): void
{
    if (current_user()) {
        redirect('dashboard');
    }
    view('home', [
        'packages' => q_all('SELECT * FROM packages WHERE is_active = 1 AND days > 0 ORDER BY sort, id'),
        'tools'    => q_all('SELECT name, icon, category FROM tools WHERE is_active = 1 ORDER BY sort, id'),
    ], 'layout_guest');
}

function page_login(): void
{
    if (current_user()) {
        redirect('dashboard');
    }
    $error = null;
    $email = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $email = strtolower(post('email'));
        $password = (string) ($_POST['password'] ?? '');
        if (login_throttled($email)) {
            $error = 'Too many failed attempts. Please wait 15 minutes and try again.';
        } else {
            $user = q_one('SELECT * FROM users WHERE email = ?', [$email]);
            // Always run password_verify so response time does not reveal which emails exist.
            $hash = $user['password_hash'] ?? '$2y$10$T0QSwwMCe2XSGCHZ54mQxOFRSIwAuMVqikkNxXtJFPswkZQd6JUbC';
            if (password_verify($password, $hash) && $user && $user['status'] === 'active') {
                if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
                    q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
                    $user = q_one('SELECT * FROM users WHERE id = ?', [$user['id']]);
                }
                clear_failed_logins($email);
                login_user($user);
                $next = (string) ($_SESSION['after_login'] ?? '');
                unset($_SESSION['after_login']);
                // Only allow local redirects.
                redirect($next !== '' && str_starts_with($next, '/') && !str_starts_with($next, '//') ? base_url() . $next : 'dashboard');
            }
            record_failed_login($email);
            $error = ($user && $user['status'] === 'banned') ? 'This account has been suspended.' : 'Wrong email or password.';
        }
    }
    view('auth/login', ['title' => 'Log in', 'error' => $error, 'email' => $email], 'layout_guest');
}

function page_register(): void
{
    if (current_user()) {
        redirect('dashboard');
    }
    $errors = [];
    $name = $email = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $name = mb_substr(post('name'), 0, 100);
        $email = strtolower(post('email'));
        $password = (string) ($_POST['password'] ?? '');
        if ($name === '') {
            $errors[] = 'Please enter your name.';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
            $errors[] = 'Please enter a valid email address.';
        }
        if ($e = validate_password($password)) {
            $errors[] = $e;
        }
        if (!$errors && q_one('SELECT id FROM users WHERE email = ?', [$email])) {
            $errors[] = 'An account with this email already exists. Please log in.';
        }
        if (!$errors) {
            q('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)', [
                $name, $email, password_hash($password, PASSWORD_DEFAULT), is_admin_email($email) ? 'admin' : 'user', now_utc(),
            ]);
            login_user(q_one('SELECT * FROM users WHERE id = ?', [(int) db()->lastInsertId()]));
            flash('success', 'Welcome to ' . config('app.name') . '! Choose a plan to start using the tools.');
            redirect('plans');
        }
    }
    view('auth/register', ['title' => 'Create account', 'errors' => $errors, 'name' => $name, 'email' => $email], 'layout_guest');
}

function page_logout(): void
{
    logout_user();
    redirect('login');
}

function page_forgot(): void
{
    $sent = false;
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $email = strtolower(post('email'));
        if (login_throttled($email)) {
            $sent = true; // same message — don't reveal anything
        } else {
            record_failed_login($email); // also rate-limits reset emails
            $user = q_one('SELECT * FROM users WHERE email = ? AND status = \'active\'', [$email]);
            if ($user) {
                $token = bin2hex(random_bytes(32));
                q('INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)', [
                    $user['id'], hash('sha256', $token), gmdate('Y-m-d H:i:s', time() + 3600), now_utc(),
                ]);
                $link = url('reset-password', ['token' => $token]);
                $body = "Hello {$user['name']},\n\nUse this link to set a new password (valid for 1 hour):\n{$link}\n\nIf you did not ask for this, ignore this email.\n\n" . config('app.name');
                @mail($user['email'], config('app.name') . ' password reset', $body, 'From: ' . config('app.mail_from'));
            }
            $sent = true;
        }
    }
    view('auth/forgot', ['title' => 'Forgot password', 'sent' => $sent], 'layout_guest');
}

function page_reset(): void
{
    $token = (string) ($_GET['token'] ?? $_POST['token'] ?? '');
    $row = preg_match('/^[a-f0-9]{64}$/', $token)
        ? q_one('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?', [hash('sha256', $token), now_utc()])
        : null;
    $error = null;
    if ($row && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $password = (string) ($_POST['password'] ?? '');
        $error = validate_password($password);
        if (!$error) {
            q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $row['user_id']]);
            q('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [now_utc(), $row['user_id']]);
            flash('success', 'Password changed. Please log in.');
            redirect('login');
        }
    }
    view('auth/reset', ['title' => 'Set new password', 'valid' => (bool) $row, 'token' => $token, 'error' => $error], 'layout_guest');
}

// ---------------------------------------------------------------------------
// Customer area
// ---------------------------------------------------------------------------

function page_dashboard(): void
{
    $u = require_login();
    view('dashboard', [
        'title'   => 'Dashboard',
        'recent'  => q_all('SELECT tu.id, tu.status, tu.credits, tu.created_at, t.name, t.icon FROM tool_usage tu JOIN tools t ON t.id = tu.tool_id WHERE tu.user_id = ? ORDER BY tu.id DESC LIMIT 6', [$u['id']]),
        'pinned'  => q_all('SELECT t.* FROM pinned_tools p JOIN tools t ON t.id = p.tool_id WHERE p.user_id = ? AND t.is_active = 1 ORDER BY t.sort', [$u['id']]),
        'used30'  => (int) q_one('SELECT COALESCE(SUM(credits),0) s FROM tool_usage WHERE user_id = ? AND status = \'success\' AND created_at > ?', [$u['id'], gmdate('Y-m-d H:i:s', time() - 30 * 86400)])['s'],
        'runs30'  => (int) q_one('SELECT COUNT(*) c FROM tool_usage WHERE user_id = ? AND status = \'success\' AND created_at > ?', [$u['id'], gmdate('Y-m-d H:i:s', time() - 30 * 86400)])['c'],
        'pending' => (int) q_one('SELECT COUNT(*) c FROM orders WHERE user_id = ? AND status = \'awaiting_review\'', [$u['id']])['c'],
    ]);
}

function page_tools(): void
{
    $u = require_login();
    $tools = q_all('SELECT t.*, (p.user_id IS NOT NULL) AS pinned FROM tools t LEFT JOIN pinned_tools p ON p.tool_id = t.id AND p.user_id = ? WHERE t.is_active = 1 ORDER BY pinned DESC, t.sort, t.id', [$u['id']]);
    $cats = array_values(array_unique(array_column($tools, 'category')));
    view('tools', ['title' => 'Tools', 'tools' => $tools, 'categories' => $cats]);
}

function page_tool(string $slug): void
{
    $u = require_login();
    $tool = tool_by_slug($slug) ?? not_found();
    $result = null;
    $error = null;
    $input = '';
    $language = 'Same as input';
    $tone = 'Professional';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = (string) ($_POST['input'] ?? '');
        $language = post('language', $language);
        $tone = post('tone', $tone);
        try {
            $result = run_tool($u, $tool, $input, $language, $tone);
        } catch (ToolError $e) {
            $error = $e->getMessage();
        }
    }
    view('tool', [
        'title' => $tool['name'], 'tool' => $tool, 'result' => $result, 'error' => $error,
        'input' => $input, 'language' => $language, 'tone' => $tone,
        'user'  => refresh_current_user(), 'available' => tool_available($tool),
    ]);
}

function page_tool_pin(string $slug): void
{
    $u = require_login();
    $tool = tool_by_slug($slug) ?? not_found();
    if (q_one('SELECT 1 FROM pinned_tools WHERE user_id = ? AND tool_id = ?', [$u['id'], $tool['id']])) {
        q('DELETE FROM pinned_tools WHERE user_id = ? AND tool_id = ?', [$u['id'], $tool['id']]);
    } else {
        q('INSERT IGNORE INTO pinned_tools (user_id, tool_id) VALUES (?, ?)', [$u['id'], $tool['id']]);
    }
    redirect(post('back') === 'tool' ? 'tools/' . $tool['slug'] : 'tools');
}

function page_plans(): void
{
    require_login();
    view('plans', ['title' => 'Plans & Credits', 'packages' => q_all('SELECT * FROM packages WHERE is_active = 1 ORDER BY sort, id')]);
}

function page_checkout(int $packageId): void
{
    $u = require_login();
    $package = q_one('SELECT * FROM packages WHERE id = ? AND is_active = 1', [$packageId]) ?? not_found();
    $methods = available_payment_methods();
    $error = null;

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $method = null;
        foreach ($methods as $m) {
            if ($m['code'] === post('method')) {
                $method = $m;
            }
        }
        $open = (int) q_one('SELECT COUNT(*) c FROM orders WHERE user_id = ? AND status IN (\'pending\',\'awaiting_review\') AND created_at > ?', [$u['id'], gmdate('Y-m-d H:i:s', time() - 3600)])['c'];
        if (!$method) {
            $error = 'Please choose a payment method.';
        } elseif ($open >= 10) {
            $error = 'You have too many unfinished orders. Please complete or wait for review of an existing one.';
        } elseif ((int) $package['days'] === 0 && config('app.require_active_plan', true) && !plan_active($u)) {
            $error = 'Top-up credits need an active monthly plan. Please buy a plan first.';
        } else {
            $order = create_order($u, $package, $method);
            if ($method['kind'] === 'manual') {
                redirect('orders/' . $order['id']);
            }
            try {
                redirect(gateway_start($order, $u));
            } catch (PaymentError | RuntimeException $e) {
                set_order_status((int) $order['id'], 'failed');
                error_log('Payment start failed: ' . $e->getMessage());
                $error = $e instanceof PaymentError ? $e->getMessage() : 'Could not connect to the payment provider. Please try another method.';
            }
        }
    }
    view('checkout', ['title' => 'Checkout', 'package' => $package, 'methods' => $methods, 'error' => $error]);
}

function page_orders(): void
{
    $u = require_login();
    view('orders', ['title' => 'Payment History', 'orders' => q_all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 200', [$u['id']])]);
}

function page_order(int $id): void
{
    $u = require_login();
    $order = find_order($id);
    if (!$order || ((int) $order['user_id'] !== (int) $u['id'] && $u['role'] !== 'admin')) {
        not_found();
    }
    $method = payment_method($order['method_code']);
    $error = null;

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $method && $method['kind'] === 'manual' && $order['status'] === 'pending' && (int) $order['user_id'] === (int) $u['id']) {
        $sender = mb_substr(post('sender'), 0, 191);
        $txid = mb_substr(preg_replace('/\s+/', '', post('txid')), 0, 191);
        if ($sender === '' || strlen($txid) < 6) {
            $error = 'Please enter the sender account and a valid transaction ID.';
        } else {
            try {
                q('UPDATE orders SET manual_sender = ?, manual_txid = ?, status = \'awaiting_review\' WHERE id = ? AND status = \'pending\'', [$sender, $txid, $order['id']]);
                flash('success', 'Thanks! We received your payment details. Credits will be added after we verify the payment (usually within a few hours).');
                redirect('orders/' . $order['id']);
            } catch (PDOException $e) {
                if ($e->getCode() !== '23000') {
                    throw $e;
                }
                $error = 'This transaction ID has already been used.';
            }
        }
    }
    view('order', ['title' => 'Order #' . $order['id'], 'order' => $order, 'method' => $method, 'error' => $error]);
}

function page_gateway_return(string $code): void
{
    try {
        $orderId = gateway_return($code);
    } catch (Throwable $e) {
        error_log('Gateway return error (' . $code . '): ' . $e);
        $orderId = null;
    }
    if (!$orderId) {
        flash('error', 'We could not confirm this payment. If money was taken, please contact support with your transaction ID.');
        redirect('orders');
    }
    $order = find_order($orderId);
    if ($order && $order['status'] === 'paid') {
        flash('success', 'Payment successful! ' . number_format((int) $order['credits']) . ' credits were added to your account.');
    } elseif ($order && $order['method_code'] === 'nowpayments' && $order['status'] === 'pending') {
        flash('info', 'Crypto payment received by the gateway. Credits are added automatically after blockchain confirmation (usually 5–30 minutes).');
    } else {
        flash('error', 'The payment was not completed.');
    }
    redirect('orders/' . $orderId);
}

function page_history(): void
{
    $u = require_login();
    view('history', [
        'title' => 'Usage History',
        'items' => q_all('SELECT tu.id, tu.status, tu.credits, tu.created_at, tu.error, t.name, t.icon FROM tool_usage tu JOIN tools t ON t.id = tu.tool_id WHERE tu.user_id = ? ORDER BY tu.id DESC LIMIT 200', [$u['id']]),
        'ledger' => q_all('SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 50', [$u['id']]),
    ]);
}

function page_history_item(int $id): void
{
    $u = require_login();
    $item = q_one('SELECT tu.*, t.name, t.icon, t.type, t.slug FROM tool_usage tu JOIN tools t ON t.id = tu.tool_id WHERE tu.id = ? AND tu.user_id = ?', [$id, $u['id']]) ?? not_found();
    view('history_item', ['title' => $item['name'], 'item' => $item]);
}

function page_account(): void
{
    $u = require_login();
    $errors = [];
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if (post('action') === 'profile') {
            $name = mb_substr(post('name'), 0, 100);
            if ($name === '') {
                $errors[] = 'Name cannot be empty.';
            } else {
                q('UPDATE users SET name = ? WHERE id = ?', [$name, $u['id']]);
                flash('success', 'Profile updated.');
                redirect('account');
            }
        } elseif (post('action') === 'password') {
            if (!password_verify((string) ($_POST['current'] ?? ''), $u['password_hash'])) {
                $errors[] = 'Current password is wrong.';
            } elseif ($e = validate_password((string) ($_POST['new'] ?? ''))) {
                $errors[] = $e;
            } else {
                q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string) $_POST['new'], PASSWORD_DEFAULT), $u['id']]);
                login_user(q_one('SELECT * FROM users WHERE id = ?', [$u['id']]));
                flash('success', 'Password changed. Other devices were logged out.');
                redirect('account');
            }
        }
    }
    view('account', ['title' => 'Account Settings', 'errors' => $errors]);
}

require __DIR__ . '/admin.php';
