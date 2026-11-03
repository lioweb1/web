<?php
declare(strict_types=1);

const LOGIN_MAX_ATTEMPTS = 5;      // per email+IP in the window below
const LOGIN_WINDOW_MINUTES = 15;

function current_user(bool $refresh = false): ?array
{
    static $user = false;
    if ($user !== false && !$refresh) {
        return $user;
    }
    $id = (int) ($_SESSION['uid'] ?? 0);
    $user = $id ? q_one('SELECT * FROM users WHERE id = ?', [$id]) : null;
    if ($user && $user['status'] !== 'active') {
        logout_user();
        $user = null;
    }
    // Invalidate other sessions when the password changes.
    if ($user && ($_SESSION['pwh'] ?? '') !== substr(hash('sha256', $user['password_hash']), 0, 16)) {
        logout_user();
        $user = null;
    }
    return $user;
}

function refresh_current_user(): array
{
    return q_one('SELECT * FROM users WHERE id = ?', [current_user()['id']]);
}

function require_login(): array
{
    $u = current_user();
    if (!$u) {
        $_SESSION['after_login'] = $_SERVER['REQUEST_URI'] ?? '';
        redirect('login');
    }
    return $u;
}

function require_admin(): array
{
    $u = require_login();
    if ($u['role'] !== 'admin') {
        not_found();
    }
    return $u;
}

function is_admin_email(string $email): bool
{
    $admins = array_map('strtolower', (array) config('app.admin_emails', []));
    return in_array(strtolower($email), $admins, true);
}

function login_user(array $user): void
{
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $user['id'];
    $_SESSION['pwh'] = substr(hash('sha256', $user['password_hash']), 0, 16);
    $role = is_admin_email($user['email']) ? 'admin' : $user['role'];
    q('UPDATE users SET last_login_at = ?, role = ? WHERE id = ?', [now_utc(), $role, $user['id']]);
}

function logout_user(): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_regenerate_id(true);
    }
}

function login_throttled(string $email): bool
{
    $since = gmdate('Y-m-d H:i:s', time() - LOGIN_WINDOW_MINUTES * 60);
    $byPair = (int) q_one('SELECT COUNT(*) c FROM login_attempts WHERE email = ? AND ip = ? AND created_at > ?', [$email, client_ip(), $since])['c'];
    $byIp   = (int) q_one('SELECT COUNT(*) c FROM login_attempts WHERE ip = ? AND created_at > ?', [client_ip(), $since])['c'];
    return $byPair >= LOGIN_MAX_ATTEMPTS || $byIp >= LOGIN_MAX_ATTEMPTS * 4;
}

function record_failed_login(string $email): void
{
    q('INSERT INTO login_attempts (ip, email, created_at) VALUES (?, ?, ?)', [client_ip(), $email, now_utc()]);
    // Housekeeping.
    if (random_int(1, 50) === 1) {
        q('DELETE FROM login_attempts WHERE created_at < ?', [gmdate('Y-m-d H:i:s', time() - 86400)]);
    }
}

function clear_failed_logins(string $email): void
{
    q('DELETE FROM login_attempts WHERE email = ? AND ip = ?', [$email, client_ip()]);
}

function validate_password(string $password): ?string
{
    if (strlen($password) < 8) {
        return 'Password must be at least 8 characters.';
    }
    if (strlen($password) > 200) {
        return 'Password is too long.';
    }
    return null;
}

function plan_active(array $user): bool
{
    return $user['plan_expires_at'] !== null && strtotime($user['plan_expires_at'] . ' UTC') > time();
}
