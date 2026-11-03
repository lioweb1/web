<?php
declare(strict_types=1);

require dirname(__DIR__) . '/inc/bootstrap.php';
require APP_ROOT . '/inc/engine.php';
require __DIR__ . '/entities.php';

$me = current_user();
if (!$me || $me['role'] !== 'admin') {
    flash('info', 'Please log in with an admin account.');
    redirect('login?next=' . rawurlencode($_SERVER['REQUEST_URI'] ?? ''));
}

$a = preg_replace('/[^a-z_]/', '', (string)($_GET['a'] ?? 'dashboard')) ?: 'dashboard';
$ENTITIES = admin_entities();

function admin_url(string $action = 'dashboard', array $params = []): string
{
    return url('admin/?' . http_build_query(['a' => $action] + $params));
}

function admin_render(string $view, array $vars = []): void
{
    global $a;
    extract($vars, EXTR_SKIP);
    ob_start();
    include __DIR__ . '/views/' . $view . '.php';
    $content = ob_get_clean();
    include __DIR__ . '/views/layout.php';
    exit;
}

if (is_post()) {
    csrf_check();
}

/* =========================================================
 * Generic CRUD (posts, pages, brokers, plans, signals)
 * ======================================================= */
if (isset($ENTITIES[$a])) {
    $ent = $ENTITIES[$a];
    $table = $ent['table'];
    $do = $_GET['do'] ?? 'list';
    $id = (int)($_GET['id'] ?? 0);

    if ($do === 'delete' && is_post()) {
        q("DELETE FROM `$table` WHERE id = ?", [$id]);
        flash('success', 'Deleted.');
        redirect(admin_url($a));
    }

    if ($do === 'action' && is_post() && isset($ent['actions'])) {
        $row = q_one("SELECT * FROM `$table` WHERE id = ?", [$id]);
        $act = (string)($_POST['act'] ?? '');
        if ($row && isset($ent['actions'][$act])) {
            ($ent['actions'][$act]['fn'])($row);
            flash('success', $ent['actions'][$act]['label'] . ' done.');
        }
        redirect(admin_url($a));
    }

    if ($do === 'edit' || $do === 'new') {
        $row = $do === 'edit' ? q_one("SELECT * FROM `$table` WHERE id = ?", [$id]) : null;
        if ($do === 'edit' && !$row) {
            redirect(admin_url($a));
        }
        if (is_post()) {
            $data = [];
            $errors = [];
            foreach ($ent['fields'] as $name => $f) {
                $type = $f['type'];
                $raw = $_POST[$name] ?? null;
                $val = match ($type) {
                    'checkbox' => !empty($raw) ? 1 : 0,
                    'number' => ($raw === '' || $raw === null) ? ($f['default'] ?? 0) : (int)$raw,
                    'decimal' => ($raw === '' || $raw === null) ? null : (float)str_replace(',', '.', (string)$raw),
                    'select' => in_array($raw, array_map('strval', array_keys($f['options'])), true) ? $raw : (string)array_key_first($f['options']),
                    default => is_string($raw) ? trim($raw) : '',
                };
                if (!empty($f['required']) && ($val === '' || $val === null)) {
                    $errors[] = $f['label'] . ' is required.';
                }
                $data[$name] = $val;
            }
            if (array_key_exists('slug', $data)) {
                $base = slugify($data['slug'] !== '' ? $data['slug'] : (string)($data['title'] ?? $data['name'] ?? ''));
                $slug = $base;
                $i = 2;
                while (q_val("SELECT id FROM `$table` WHERE slug = ? AND id <> ?", [$slug, $id])) {
                    $slug = $base . '-' . $i++;
                }
                $data['slug'] = $slug;
            }
            if (isset($ent['before_save'])) {
                $data = ($ent['before_save'])($data, $row);
            }
            if ($errors) {
                foreach ($errors as $er) flash('error', $er);
                $row = array_merge($row ?? [], $data);
            } else {
                $cols = array_keys($data);
                if ($row && $do === 'edit') {
                    $set = implode(', ', array_map(fn($c) => "`$c` = ?", $cols));
                    q("UPDATE `$table` SET $set WHERE id = ?", [...array_values($data), $id]);
                } else {
                    $ph = implode(', ', array_fill(0, count($cols), '?'));
                    q("INSERT INTO `$table` (`" . implode('`, `', $cols) . "`) VALUES ($ph)", array_values($data));
                    $id = (int)db()->lastInsertId();
                }
                if (isset($ent['after_save'])) {
                    ($ent['after_save'])($id);
                }
                flash('success', 'Saved.');
                redirect(isset($_POST['save_close']) ? admin_url($a) : admin_url($a, ['do' => 'edit', 'id' => $id]));
            }
        }
        admin_render('form', ['ent' => $ent, 'row' => $row, 'id' => $id, 'title' => ($row ? 'Edit ' : 'New ') . $ent['singular']]);
    }

    // list
    $page = current_page();
    $per = 25;
    $where = '1=1';
    $params = [];
    $search = trim((string)($_GET['s'] ?? ''));
    if ($search !== '' && !empty($ent['search'])) {
        $where .= ' AND (' . implode(' OR ', array_map(fn($c) => "`$c` LIKE ?", $ent['search'])) . ')';
        foreach ($ent['search'] as $_) $params[] = '%' . $search . '%';
    }
    foreach ($ent['filters'] ?? [] as $col => $opts) {
        if (isset($_GET[$col]) && $_GET[$col] !== '' && array_key_exists($_GET[$col], $opts)) {
            $where .= " AND `$col` = ?";
            $params[] = $_GET[$col];
        }
    }
    $total = (int)q_val("SELECT COUNT(*) FROM `$table` WHERE $where", $params);
    $rows = q("SELECT * FROM `$table` WHERE $where ORDER BY {$ent['order']} LIMIT $per OFFSET " . (($page - 1) * $per), $params)->fetchAll();
    $qs = $_GET;
    unset($qs['page'], $qs['a']);
    admin_render('list', ['ent' => $ent, 'rows' => $rows, 'title' => $ent['title'], 'search' => $search, 'pager' => pagination($total, $per, $page, admin_url($a, $qs)), 'total' => $total]);
}

/* =========================================================
 * Other admin screens
 * ======================================================= */
switch ($a) {
    case 'dashboard':
        if (is_post() && ($_POST['do'] ?? '') === 'run_engine') {
            $engine = new SignalEngine();
            $r = $engine->run();
            flash('success', "Engine finished: {$r['created']} new signal(s), {$r['closed']} closed, {$r['telegram']} sent to Telegram.");
            foreach (array_slice($engine->messages(), -8) as $m) {
                if (str_starts_with($m, '[warn]')) flash('error', $m);
            }
            redirect(admin_url());
        }
        if (is_post() && ($_POST['do'] ?? '') === 'test_telegram') {
            $ok = false;
            foreach (['telegram_free_chat', 'telegram_premium_chat'] as $k) {
                if (setting($k) !== '') $ok = telegram_send(setting($k), '✅ Test message from <b>' . e(setting('site_name')) . '</b>') || $ok;
            }
            flash($ok ? 'success' : 'error', $ok ? 'Telegram test sent.' : 'Telegram failed. Check bot token, chat IDs and that the bot is admin of the channel.');
            redirect(admin_url());
        }
        $since = gmdate('Y-m-d H:i:s', time() - 30 * 86400);
        admin_render('dashboard', [
            'title' => 'Dashboard',
            'c' => [
                'users' => (int)q_val('SELECT COUNT(*) FROM users'),
                'premium' => (int)q_val('SELECT COUNT(*) FROM users WHERE premium_until > ?', [now_utc()]),
                'new_users' => (int)q_val('SELECT COUNT(*) FROM users WHERE created_at > ?', [$since]),
                'subscribers' => (int)q_val("SELECT COUNT(*) FROM subscribers WHERE status = 'subscribed'"),
                'pending' => (int)q_val("SELECT COUNT(*) FROM payments WHERE status = 'pending'"),
                'revenue' => (float)q_val("SELECT COALESCE(SUM(amount),0) FROM payments WHERE status = 'approved' AND created_at > ?", [$since]),
                'active' => (int)q_val("SELECT COUNT(*) FROM signals WHERE status = 'active'"),
                'today' => (int)q_val('SELECT COUNT(*) FROM signals WHERE created_at > ?', [gmdate('Y-m-d 00:00:00')]),
                'clicks' => (int)q_val('SELECT COUNT(*) FROM clicks WHERE created_at > ?', [$since]),
            ],
            'stats' => signal_stats(30),
            'topBrokers' => q('SELECT b.name, COUNT(c.id) n FROM brokers b LEFT JOIN clicks c ON c.broker_id = b.id AND c.created_at > ? GROUP BY b.id ORDER BY n DESC LIMIT 5', [$since])->fetchAll(),
            'pendingPayments' => q("SELECT p.*, u.email, pl.name plan_name FROM payments p JOIN users u ON u.id = p.user_id LEFT JOIN plans pl ON pl.id = p.plan_id WHERE p.status = 'pending' ORDER BY p.id LIMIT 5")->fetchAll(),
            'log' => q('SELECT * FROM engine_log ORDER BY id DESC LIMIT 10')->fetchAll(),
            'charts' => [
                'Signups' => daily_series("SELECT DATE(created_at) d, COUNT(*) n FROM users WHERE created_at >= ? GROUP BY DATE(created_at)"),
                'Revenue' => daily_series("SELECT DATE(created_at) d, SUM(amount) n FROM payments WHERE status = 'approved' AND created_at >= ? GROUP BY DATE(created_at)"),
                'Subscribers' => daily_series("SELECT DATE(created_at) d, COUNT(*) n FROM subscribers WHERE created_at >= ? GROUP BY DATE(created_at)"),
                'Affiliate clicks' => daily_series("SELECT DATE(created_at) d, COUNT(*) n FROM clicks WHERE created_at >= ? GROUP BY DATE(created_at)"),
            ],
        ]);

    case 'payments':
        if (is_post()) {
            $p = q_one('SELECT * FROM payments WHERE id = ?', [(int)($_POST['id'] ?? 0)]);
            $do = $_POST['do'] ?? '';
            if ($p && $do === 'approve' && $p['status'] !== 'approved') {
                $days = approve_payment($p);
                flash('success', "Approved. User got $days premium days.");
            } elseif ($p && $do === 'reject') {
                q("UPDATE payments SET status = 'rejected', reviewed_at = ? WHERE id = ?", [now_utc(), $p['id']]);
                flash('success', 'Rejected.');
            } elseif ($p && $do === 'delete') {
                q('DELETE FROM payments WHERE id = ?', [$p['id']]);
                flash('success', 'Deleted.');
            }
            redirect(admin_url('payments', ['status' => $_GET['status'] ?? '']));
        }
        $status = in_array($_GET['status'] ?? '', ['pending', 'approved', 'rejected'], true) ? $_GET['status'] : '';
        admin_render('payments', [
            'title' => 'Payments',
            'status' => $status,
            'rows' => q('SELECT p.*, u.email, u.name, pl.name plan_name FROM payments p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN plans pl ON pl.id = p.plan_id ' . ($status ? 'WHERE p.status = ? ' : '') . "ORDER BY p.status = 'pending' DESC, p.id DESC LIMIT 200", $status ? [$status] : [])->fetchAll(),
        ]);

    case 'users':
        if (is_post()) {
            $do = $_POST['do'] ?? '';
            $uid = (int)($_POST['id'] ?? 0);
            if ($do === 'save') {
                $email = strtolower(post_str('email', 190));
                $role = ($_POST['role'] ?? 'user') === 'admin' ? 'admin' : 'user';
                $status = ($_POST['status'] ?? 'active') === 'banned' ? 'banned' : 'active';
                $premium = post_str('premium_until', 30);
                $premium = $premium !== '' ? gmdate('Y-m-d H:i:s', strtotime(str_replace('T', ' ', $premium) . ' UTC')) : null;
                if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    flash('error', 'Invalid email.');
                } elseif (q_val('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, $uid])) {
                    flash('error', 'Email already used by another account.');
                } elseif ($uid === (int)$me['id'] && ($role !== 'admin' || $status !== 'active')) {
                    flash('error', 'You cannot remove your own admin access.');
                } else {
                    if ($uid) {
                        q('UPDATE users SET name = ?, email = ?, role = ?, status = ?, premium_until = ? WHERE id = ?', [post_str('name', 120), $email, $role, $status, $premium, $uid]);
                    } else {
                        $pw = (string)($_POST['password'] ?? '');
                        if (strlen($pw) < 8) {
                            flash('error', 'Password must be at least 8 characters.');
                            redirect(admin_url('users', ['edit' => 'new']));
                        }
                        q('INSERT INTO users (name, email, password_hash, role, status, premium_until, ref_code) VALUES (?,?,?,?,?,?,?)', [post_str('name', 120) ?: $email, $email, password_hash($pw, PASSWORD_DEFAULT), $role, $status, $premium, new_ref_code()]);
                        $uid = (int)db()->lastInsertId();
                    }
                    if ($uid && strlen((string)($_POST['password'] ?? '')) >= 8) {
                        q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string)$_POST['password'], PASSWORD_DEFAULT), $uid]);
                    }
                    flash('success', 'User saved.');
                }
                redirect(admin_url('users', ['edit' => $uid ?: 'new']));
            }
            if ($do === 'add_days') {
                add_premium_days($uid, max(1, (int)($_POST['days'] ?? 30)));
                flash('success', 'Premium extended.');
            }
            if ($do === 'delete' && $uid !== (int)$me['id']) {
                q('DELETE FROM users WHERE id = ?', [$uid]);
                q('DELETE FROM payments WHERE user_id = ?', [$uid]);
                flash('success', 'User deleted.');
            }
            redirect(admin_url('users'));
        }
        if (isset($_GET['edit'])) {
            $u = $_GET['edit'] === 'new' ? null : q_one('SELECT * FROM users WHERE id = ?', [(int)$_GET['edit']]);
            admin_render('user_edit', ['title' => $u ? 'Edit user' : 'New user', 'u' => $u,
                'refBy' => $u && $u['referred_by'] ? q_one('SELECT id, email FROM users WHERE id = ?', [$u['referred_by']]) : null,
                'payments' => $u ? q('SELECT p.*, pl.name plan_name FROM payments p LEFT JOIN plans pl ON pl.id = p.plan_id WHERE user_id = ? ORDER BY id DESC', [$u['id']])->fetchAll() : [],
            ]);
        }
        $page = current_page();
        $s = trim((string)($_GET['s'] ?? ''));
        $filter = $_GET['f'] ?? '';
        $where = '1=1';
        $params = [];
        if ($s !== '') { $where .= ' AND (email LIKE ? OR name LIKE ?)'; $params[] = "%$s%"; $params[] = "%$s%"; }
        if ($filter === 'premium') { $where .= ' AND premium_until > ?'; $params[] = now_utc(); }
        if ($filter === 'admin') { $where .= " AND role = 'admin'"; }
        $total = (int)q_val("SELECT COUNT(*) FROM users WHERE $where", $params);
        admin_render('users', [
            'title' => 'Users',
            's' => $s, 'f' => $filter, 'total' => $total,
            'rows' => q("SELECT u.*, (SELECT COUNT(*) FROM users r WHERE r.referred_by = u.id) refs FROM users u WHERE $where ORDER BY id DESC LIMIT 30 OFFSET " . (($page - 1) * 30), $params)->fetchAll(),
            'pager' => pagination($total, 30, $page, admin_url('users', ['s' => $s, 'f' => $filter])),
        ]);

    case 'subscribers':
        if (isset($_GET['export'])) {
            $only = ($_GET['export'] ?? '') === 'subscribed';
            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename="subscribers-' . gmdate('Ymd') . '.csv"');
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, ['email', 'name', 'status', 'source', 'subscribed_at_utc', 'consent', 'ip', 'unsubscribe_url']);
            $st = q('SELECT * FROM subscribers ' . ($only ? "WHERE status = 'subscribed' " : '') . 'ORDER BY id');
            while ($r = $st->fetch()) {
                fputcsv($out, [$r['email'], $r['name'], $r['status'], $r['source'], $r['created_at'], $r['consent_text'], $r['ip'], url('unsubscribe/' . $r['token'])]);
            }
            exit;
        }
        if (is_post()) {
            $do = $_POST['do'] ?? '';
            if ($do === 'delete') {
                q('DELETE FROM subscribers WHERE id = ?', [(int)$_POST['id']]);
                flash('success', 'Deleted.');
            } elseif ($do === 'toggle') {
                q("UPDATE subscribers SET status = IF(status = 'subscribed', 'unsubscribed', 'subscribed') WHERE id = ?", [(int)$_POST['id']]);
            } elseif ($do === 'add') {
                add_subscriber(post_str('email', 190), post_str('name', 120), 'admin') ? flash('success', 'Added.') : flash('error', 'Invalid email.');
            } elseif ($do === 'import' && !empty($_FILES['csv']['tmp_name']) && is_uploaded_file($_FILES['csv']['tmp_name'])) {
                $n = 0;
                if (($fh = fopen($_FILES['csv']['tmp_name'], 'r')) !== false) {
                    while (($line = fgetcsv($fh)) !== false) {
                        if (isset($line[0]) && add_subscriber(trim((string)$line[0], " \t\xEF\xBB\xBF"), trim((string)($line[1] ?? '')), 'import')) $n++;
                    }
                    fclose($fh);
                }
                flash('success', "Imported $n email(s).");
            }
            redirect(admin_url('subscribers'));
        }
        $page = current_page();
        $s = trim((string)($_GET['s'] ?? ''));
        $where = $s !== '' ? 'WHERE email LIKE ? OR name LIKE ?' : '';
        $params = $s !== '' ? ["%$s%", "%$s%"] : [];
        $total = (int)q_val("SELECT COUNT(*) FROM subscribers $where", $params);
        admin_render('subscribers', [
            'title' => 'Email subscribers',
            's' => $s, 'total' => $total,
            'active' => (int)q_val("SELECT COUNT(*) FROM subscribers WHERE status = 'subscribed'"),
            'rows' => q("SELECT * FROM subscribers $where ORDER BY id DESC LIMIT 50 OFFSET " . (($page - 1) * 50), $params)->fetchAll(),
            'pager' => pagination($total, 50, $page, admin_url('subscribers', ['s' => $s])),
        ]);

    case 'settings':
        $groups = admin_settings_groups();
        $tab = isset($groups[$_GET['tab'] ?? '']) ? $_GET['tab'] : array_key_first($groups);
        if (is_post()) {
            foreach ($groups[$tab]['fields'] as $key => $f) {
                $type = $f[1];
                if ($type === 'checkbox') {
                    save_setting($key, !empty($_POST[$key]) ? '1' : '0');
                } elseif (isset($_POST[$key]) && is_string($_POST[$key])) {
                    $v = $type === 'code' ? $_POST[$key] : trim($_POST[$key]);
                    if ($type === 'color' && !preg_match('/^#[0-9a-fA-F]{3,8}$/', $v)) continue;
                    if ($key === 'display_timezone' && !in_array($v, DateTimeZone::listIdentifiers(), true)) continue;
                    save_setting($key, $v);
                }
            }
            flash('success', 'Settings saved.');
            redirect(admin_url('settings', ['tab' => $tab]));
        }
        admin_render('settings', ['title' => 'Settings', 'groups' => $groups, 'tab' => $tab, 'values' => settings_all(true)]);

    case 'media':
        $dir = APP_ROOT . '/uploads';
        if (is_post()) {
            if (($_POST['do'] ?? '') === 'delete') {
                $f = basename((string)($_POST['file'] ?? ''));
                if ($f !== '' && $f[0] !== '.' && is_file("$dir/$f")) unlink("$dir/$f");
                flash('success', 'Deleted.');
            } elseif (!empty($_FILES['file']['tmp_name'])) {
                $res = handle_upload($_FILES['file'], $dir);
                if (isset($_GET['json'])) json_out($res['ok'] ? ['url' => url('uploads/' . $res['name'])] : ['error' => $res['error']], $res['ok'] ? 200 : 422);
                $res['ok'] ? flash('success', 'Uploaded: ' . url('uploads/' . $res['name'])) : flash('error', $res['error']);
            }
            redirect(admin_url('media'));
        }
        $files = [];
        foreach (glob($dir . '/*.{jpg,jpeg,png,gif,webp,ico}', GLOB_BRACE) ?: [] as $f) {
            $files[] = ['name' => basename($f), 'url' => url('uploads/' . basename($f)), 'size' => filesize($f), 'time' => filemtime($f)];
        }
        usort($files, fn($x, $y) => $y['time'] <=> $x['time']);
        if (isset($_GET['json'])) json_out(['files' => $files]);
        admin_render('media', ['title' => 'Media library', 'files' => $files]);

    case 'backup':
        if (is_post()) {
            @set_time_limit(300);
            header('Content-Type: application/sql; charset=utf-8');
            header('Content-Disposition: attachment; filename="backup-' . gmdate('Ymd-His') . '.sql"');
            echo "-- " . setting('site_name') . " backup " . gmdate('Y-m-d H:i:s') . " UTC\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n";
            $pdo = db();
            foreach (q('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table) {
                $create = q("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_NUM);
                echo "DROP TABLE IF EXISTS `$table`;\n" . $create[1] . ";\n\n";
                $st = q("SELECT * FROM `$table`");
                while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
                    $vals = array_map(fn($v) => $v === null ? 'NULL' : $pdo->quote((string)$v), $row);
                    echo "INSERT INTO `$table` (`" . implode('`,`', array_keys($row)) . '`) VALUES (' . implode(',', $vals) . ");\n";
                }
                echo "\n";
                flush();
            }
            echo "SET FOREIGN_KEY_CHECKS=1;\n";
            exit;
        }
        $sizes = q('SELECT table_name t, table_rows r, ROUND((data_length + index_length) / 1024) kb FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY t')->fetchAll();
        admin_render('backup', ['title' => 'Backup', 'sizes' => $sizes]);

    case 'log':
        if (is_post()) {
            q('DELETE FROM engine_log');
            redirect(admin_url('log'));
        }
        admin_render('log', ['title' => 'Engine log', 'rows' => q('SELECT * FROM engine_log ORDER BY id DESC LIMIT 300')->fetchAll()]);

    case 'clicks':
        $since = gmdate('Y-m-d H:i:s', time() - 30 * 86400);
        admin_render('clicks', [
            'title' => 'Affiliate clicks',
            'perBroker' => q('SELECT b.id, b.name, b.clicks total, (SELECT COUNT(*) FROM clicks c WHERE c.broker_id = b.id AND c.created_at > ?) last30, (SELECT COUNT(DISTINCT ip_hash) FROM clicks c WHERE c.broker_id = b.id AND c.created_at > ?) uniq30 FROM brokers b ORDER BY last30 DESC', [$since, $since])->fetchAll(),
            'recent' => q('SELECT c.*, b.name FROM clicks c LEFT JOIN brokers b ON b.id = c.broker_id ORDER BY c.id DESC LIMIT 100')->fetchAll(),
        ]);

    default:
        redirect(admin_url());
}

/* ---------- helpers ---------- */
function daily_series(string $sql, int $days = 30): array
{
    $map = [];
    foreach (q($sql, [gmdate('Y-m-d 00:00:00', time() - ($days - 1) * 86400)])->fetchAll() as $r) {
        $map[$r['d']] = (float)$r['n'];
    }
    $out = [];
    for ($i = $days - 1; $i >= 0; $i--) {
        $d = gmdate('Y-m-d', time() - $i * 86400);
        $out[$d] = $map[$d] ?? 0;
    }
    return $out;
}

function handle_upload(array $file, string $dir): array
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        return ['ok' => false, 'error' => 'Upload failed.'];
    }
    if ($file['size'] > 5 * 1024 * 1024) {
        return ['ok' => false, 'error' => 'Max file size is 5 MB.'];
    }
    $ext = strtolower(pathinfo((string)$file['name'], PATHINFO_EXTENSION));
    $allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'ico'];
    if (!in_array($ext, $allowed, true)) {
        return ['ok' => false, 'error' => 'Only JPG, PNG, GIF, WEBP and ICO images are allowed.'];
    }
    if ($ext !== 'ico' && @getimagesize($file['tmp_name']) === false) {
        return ['ok' => false, 'error' => 'This file is not a valid image.'];
    }
    $base = slugify(pathinfo((string)$file['name'], PATHINFO_FILENAME));
    $name = substr($base, 0, 40) . '-' . bin2hex(random_bytes(4)) . '.' . $ext;
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    if (!move_uploaded_file($file['tmp_name'], "$dir/$name")) {
        return ['ok' => false, 'error' => 'Could not save file. Check folder permissions of /uploads.'];
    }
    return ['ok' => true, 'name' => $name];
}
