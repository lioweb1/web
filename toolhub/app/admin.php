<?php
declare(strict_types=1);

// ---------------------------------------------------------------------------
// Admin panel. Every handler starts with require_admin().
// ---------------------------------------------------------------------------

function admin_dashboard(): void
{
    require_admin();
    $since30 = gmdate('Y-m-d H:i:s', time() - 30 * 86400);
    view('admin/dashboard', [
        'title'    => 'Admin',
        'users'    => (int) q_one('SELECT COUNT(*) c FROM users')['c'],
        'active'   => (int) q_one('SELECT COUNT(*) c FROM users WHERE plan_expires_at > ?', [now_utc()])['c'],
        'review'   => (int) q_one('SELECT COUNT(*) c FROM orders WHERE status = \'awaiting_review\'')['c'],
        'revenue'  => q_all('SELECT currency, SUM(amount) total, COUNT(*) n FROM orders WHERE status = \'paid\' AND paid_at > ? GROUP BY currency', [$since30]),
        'runs'     => (int) q_one('SELECT COUNT(*) c FROM tool_usage WHERE status = \'success\' AND created_at > ?', [$since30])['c'],
        'topTools' => q_all('SELECT t.name, t.icon, COUNT(*) n FROM tool_usage tu JOIN tools t ON t.id = tu.tool_id WHERE tu.status = \'success\' AND tu.created_at > ? GROUP BY t.id ORDER BY n DESC LIMIT 8', [$since30]),
        'checks'   => admin_setup_checks(),
    ]);
}

function admin_setup_checks(): array
{
    $checks = [];
    $checks[] = ['HTTPS enabled', str_starts_with(base_url(), 'https://'), 'Set app.base_url to https://… and install SSL (cPanel > SSL/TLS Status).'];
    $checks[] = ['Debug mode off', !config('app.debug'), 'Set app.debug to false in config.php.'];
    $checks[] = ['Composer packages installed', class_exists(\Anthropic\Client::class), 'Upload the vendor/ folder (see README).'];
    $checks[] = ['Claude API key', config('anthropic.api_key') !== '', 'Add anthropic.api_key in config.php to enable AI tools.'];
    $checks[] = ['Admin email set', !in_array('you@example.com', (array) config('app.admin_emails'), true), 'Put your own email in app.admin_emails.'];
    $checks[] = ['Storage folder writable', is_writable(APP_DIR . '/storage'), 'Set permission 755 on app/storage.'];
    $checks[] = ['App folder outside public_html', !str_contains(str_replace('\\', '/', APP_DIR), '/public_html/'), 'Recommended: move the app folder outside public_html (see README).'];
    return $checks;
}

function admin_payments(): void
{
    $admin = require_admin();
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $id = (int) post('order_id');
        $order = find_order($id) ?? not_found();
        $note = mb_substr(post('note'), 0, 255) ?: null;
        if (post('action') === 'approve' && in_array($order['status'], ['awaiting_review', 'pending', 'failed'], true)) {
            // Admin confirms they received exactly the order amount.
            fulfill_order($id, $order['amount'], $order['currency'], $order['manual_txid'] ?: ('admin:' . $admin['id']));
            if ($note) {
                q('UPDATE orders SET admin_note = ? WHERE id = ?', [$note, $id]);
            }
            flash('success', "Order #{$id} approved and credits delivered.");
        } elseif (post('action') === 'reject' && $order['status'] !== 'paid') {
            set_order_status($id, 'rejected', $note ?? 'Payment could not be verified.');
            flash('success', "Order #{$id} rejected.");
        }
        redirect('admin/payments?status=' . urlencode((string) ($_GET['status'] ?? 'awaiting_review')));
    }
    $status = (string) ($_GET['status'] ?? 'awaiting_review');
    $allowed = ['awaiting_review', 'pending', 'paid', 'rejected', 'failed', 'cancelled', 'all'];
    if (!in_array($status, $allowed, true)) {
        $status = 'awaiting_review';
    }
    $sql = 'SELECT o.*, u.email, u.name AS user_name FROM orders o JOIN users u ON u.id = o.user_id';
    $orders = $status === 'all'
        ? q_all($sql . ' ORDER BY o.id DESC LIMIT 300')
        : q_all($sql . ' WHERE o.status = ? ORDER BY o.id DESC LIMIT 300', [$status]);
    view('admin/payments', ['title' => 'Payments', 'orders' => $orders, 'status' => $status, 'statuses' => $allowed]);
}

function admin_users(): void
{
    require_admin();
    $s = trim((string) ($_GET['q'] ?? ''));
    $users = $s !== ''
        ? q_all('SELECT * FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY id DESC LIMIT 200', ['%' . $s . '%', '%' . $s . '%'])
        : q_all('SELECT * FROM users ORDER BY id DESC LIMIT 200');
    view('admin/users', ['title' => 'Users', 'users' => $users, 'q' => $s]);
}

function admin_user(int $id): void
{
    $admin = require_admin();
    $user = q_one('SELECT * FROM users WHERE id = ?', [$id]) ?? not_found();
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $action = post('action');
        if ($action === 'credits') {
            $delta = (int) post('delta');
            $reason = mb_substr(post('reason'), 0, 150) ?: 'Manual adjustment';
            $ok = $delta !== 0 && transaction(fn () => ledger_change($id, $delta, 'Admin: ' . $reason . ' (by #' . $admin['id'] . ')'));
            flash($ok ? 'success' : 'error', $ok ? 'Credits updated.' : 'Could not change credits (balance cannot go below 0).');
        } elseif ($action === 'plan') {
            $days = max(-3650, min(3650, (int) post('days')));
            $start = plan_active($user) ? strtotime($user['plan_expires_at'] . ' UTC') : time();
            q('UPDATE users SET plan_expires_at = ?, plan_name = COALESCE(plan_name, \'Manual\') WHERE id = ?', [gmdate('Y-m-d H:i:s', $start + $days * 86400), $id]);
            flash('success', 'Plan updated.');
        } elseif ($action === 'status' && $id !== (int) $admin['id']) {
            q('UPDATE users SET status = ? WHERE id = ?', [$user['status'] === 'active' ? 'banned' : 'active', $id]);
            flash('success', 'Status updated.');
        }
        redirect('admin/users/' . $id);
    }
    view('admin/user', [
        'title'  => $user['name'],
        'u'      => $user,
        'orders' => q_all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50', [$id]),
        'ledger' => q_all('SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 50', [$id]),
    ]);
}

function admin_tools(): void
{
    require_admin();
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && post('action') === 'toggle') {
        q('UPDATE tools SET is_active = 1 - is_active WHERE id = ?', [(int) post('id')]);
        redirect('admin/tools');
    }
    view('admin/tools', ['title' => 'Tools', 'tools' => q_all('SELECT * FROM tools ORDER BY sort, id')]);
}

function admin_tool_edit(string $idOrNew): void
{
    require_admin();
    $tool = $idOrNew === 'new'
        ? ['id' => 0, 'slug' => '', 'name' => '', 'category' => 'Content Writing', 'icon' => '✨', 'description' => '', 'type' => 'ai_text', 'system_prompt' => '', 'input_label' => 'Your input', 'input_placeholder' => '', 'show_tone' => 0, 'show_language' => 1, 'credit_cost' => 1, 'is_new' => 1, 'is_active' => 1, 'sort' => 100]
        : (q_one('SELECT * FROM tools WHERE id = ?', [(int) $idOrNew]) ?? not_found());
    $errors = [];
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = [
            'slug'              => strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', post('slug') ?: post('name')), '-')),
            'name'              => mb_substr(post('name'), 0, 100),
            'category'          => mb_substr(post('category'), 0, 50),
            'icon'              => mb_substr(post('icon'), 0, 8) ?: '✨',
            'description'       => mb_substr(post('description'), 0, 255),
            'type'              => post('type') === 'seo_keywords' ? 'seo_keywords' : 'ai_text',
            'system_prompt'     => (string) ($_POST['system_prompt'] ?? ''),
            'input_label'       => mb_substr(post('input_label'), 0, 120) ?: 'Your input',
            'input_placeholder' => mb_substr(post('input_placeholder'), 0, 255),
            'show_tone'         => isset($_POST['show_tone']) ? 1 : 0,
            'show_language'     => isset($_POST['show_language']) ? 1 : 0,
            'credit_cost'       => max(0, min(1000, (int) post('credit_cost'))),
            'is_new'            => isset($_POST['is_new']) ? 1 : 0,
            'is_active'         => isset($_POST['is_active']) ? 1 : 0,
            'sort'              => (int) post('sort'),
        ];
        if ($data['name'] === '' || $data['slug'] === '' || $data['category'] === '') {
            $errors[] = 'Name, slug and category are required.';
        }
        if ($data['type'] === 'ai_text' && trim($data['system_prompt']) === '') {
            $errors[] = 'AI tools need instructions (system prompt).';
        }
        if (!$errors) {
            try {
                if ($tool['id']) {
                    $sets = implode(', ', array_map(fn ($k) => "$k = ?", array_keys($data)));
                    q("UPDATE tools SET $sets WHERE id = ?", [...array_values($data), $tool['id']]);
                } else {
                    $cols = implode(', ', array_keys($data));
                    $qs = implode(', ', array_fill(0, count($data), '?'));
                    q("INSERT INTO tools ($cols) VALUES ($qs)", array_values($data));
                }
                flash('success', 'Tool saved.');
                redirect('admin/tools');
            } catch (PDOException $e) {
                if ($e->getCode() !== '23000') {
                    throw $e;
                }
                $errors[] = 'Another tool already uses this slug.';
            }
        }
        $tool = array_merge($tool, $data);
    }
    view('admin/tool_edit', ['title' => $tool['id'] ? 'Edit tool' : 'New tool', 'tool' => $tool, 'errors' => $errors]);
}

function admin_packages(): void
{
    require_admin();
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $id = (int) post('id');
        $data = [
            mb_substr(post('name'), 0, 100),
            mb_substr(post('description'), 0, 255),
            max(0, (int) post('credits')),
            max(0, (int) post('days')),
            max(0, round((float) post('price_bdt'), 2)),
            max(0, round((float) post('price_usd'), 2)),
            isset($_POST['is_featured']) ? 1 : 0,
            isset($_POST['is_active']) ? 1 : 0,
            (int) post('sort'),
        ];
        if ($data[0] === '' || $data[2] === 0 || ($data[4] <= 0 && $data[5] <= 0)) {
            flash('error', 'Name, credits and at least one price are required.');
        } elseif ($id) {
            q('UPDATE packages SET name=?, description=?, credits=?, days=?, price_bdt=?, price_usd=?, is_featured=?, is_active=?, sort=? WHERE id = ?', [...$data, $id]);
            flash('success', 'Package saved.');
        } else {
            q('INSERT INTO packages (name, description, credits, days, price_bdt, price_usd, is_featured, is_active, sort) VALUES (?,?,?,?,?,?,?,?,?)', $data);
            flash('success', 'Package created.');
        }
        redirect('admin/packages');
    }
    view('admin/packages', ['title' => 'Packages', 'packages' => q_all('SELECT * FROM packages ORDER BY sort, id')]);
}

function admin_methods(): void
{
    require_admin();
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        q('UPDATE payment_methods SET name = ?, account_details = ?, instructions = ?, is_active = ?, sort = ? WHERE id = ?', [
            mb_substr(post('name'), 0, 80),
            mb_substr((string) ($_POST['account_details'] ?? ''), 0, 2000),
            mb_substr((string) ($_POST['instructions'] ?? ''), 0, 2000),
            isset($_POST['is_active']) ? 1 : 0,
            (int) post('sort'),
            (int) post('id'),
        ]);
        flash('success', 'Payment method saved.');
        redirect('admin/methods');
    }
    $methods = q_all('SELECT * FROM payment_methods ORDER BY sort, id');
    foreach ($methods as &$m) {
        $m['configured'] = $m['kind'] === 'manual' || gateway_configured($m['code']);
    }
    view('admin/methods', ['title' => 'Payment Methods', 'methods' => $methods]);
}
