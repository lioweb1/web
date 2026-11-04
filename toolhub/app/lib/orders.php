<?php
declare(strict_types=1);

function payment_method(string $code): ?array
{
    return q_one('SELECT * FROM payment_methods WHERE code = ?', [$code]);
}

/** Active methods whose gateway keys are configured (manual methods only need to be active). */
function available_payment_methods(): array
{
    $out = [];
    foreach (q_all('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY sort, id') as $m) {
        if ($m['kind'] === 'manual' || gateway_configured($m['code'])) {
            $out[] = $m;
        }
    }
    return $out;
}

/** Every order is charged in US dollars (USDT is treated as 1:1 with USD). */
function order_amount(array $package): string
{
    return number_format((float) $package['price_usd'], 2, '.', '');
}

/** Create a pending order. Price is always taken from the database, never from the browser. */
function create_order(array $user, array $package, array $method): array
{
    $amount = order_amount($package);
    q(
        'INSERT INTO orders (user_id, package_id, package_name, credits, days, method_code, currency, amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'pending\', ?)',
        [$user['id'], $package['id'], $package['name'], $package['credits'], $package['days'], $method['code'], 'USD', $amount, now_utc()]
    );
    return find_order((int) db()->lastInsertId());
}

function find_order(int $id): ?array
{
    return q_one('SELECT * FROM orders WHERE id = ?', [$id]);
}

function find_order_by_ref(string $methodCode, string $ref): ?array
{
    return q_one('SELECT * FROM orders WHERE method_code = ? AND gateway_ref = ?', [$methodCode, $ref]);
}

function set_order_ref(int $orderId, string $ref): void
{
    q('UPDATE orders SET gateway_ref = ? WHERE id = ?', [$ref, $orderId]);
}

/** Compare money amounts as integers of minor units to avoid float errors. */
function amounts_match(string|float $a, string|float $b): bool
{
    return (int) round((float) $a * 100) === (int) round((float) $b * 100);
}

/**
 * Mark an order paid and deliver credits + plan days. Safe to call many times
 * (webhook + return page): only the first call delivers anything.
 *
 * The caller must pass the amount and currency that the payment provider
 * confirmed. They are checked against the order before anything is delivered.
 */
function fulfill_order(int $orderId, string $paidAmount, string $paidCurrency, ?string $txn = null): bool
{
    return transaction(function () use ($orderId, $paidAmount, $paidCurrency, $txn): bool {
        $order = q_one('SELECT * FROM orders WHERE id = ? FOR UPDATE', [$orderId]);
        if (!$order) {
            return false;
        }
        if ($order['status'] === 'paid') {
            return true; // already delivered
        }
        if (!in_array($order['status'], ['pending', 'awaiting_review', 'failed', 'cancelled'], true)) {
            return false;
        }
        if (!in_array(strtoupper($paidCurrency), ['USD', 'USDT'], true)) {
            error_log("Order {$orderId}: currency mismatch {$paidCurrency} vs {$order['currency']}");
            return false;
        }
        if (!amounts_match($paidAmount, $order['amount'])) {
            error_log("Order {$orderId}: amount mismatch {$paidAmount} vs {$order['amount']}");
            return false;
        }

        q('UPDATE orders SET status = \'paid\', paid_at = ?, gateway_txn = COALESCE(?, gateway_txn) WHERE id = ?', [now_utc(), $txn, $orderId]);
        ledger_change((int) $order['user_id'], (int) $order['credits'], 'Purchase: ' . $order['package_name'] . ' (order #' . $orderId . ')', 'order', $orderId);

        if ((int) $order['days'] > 0) {
            $u = q_one('SELECT plan_expires_at FROM users WHERE id = ? FOR UPDATE', [$order['user_id']]);
            $start = ($u['plan_expires_at'] && strtotime($u['plan_expires_at'] . ' UTC') > time())
                ? strtotime($u['plan_expires_at'] . ' UTC')
                : time();
            $expires = gmdate('Y-m-d H:i:s', $start + (int) $order['days'] * 86400);
            q('UPDATE users SET plan_name = ?, plan_expires_at = ? WHERE id = ?', [$order['package_name'], $expires, $order['user_id']]);
        }
        return true;
    });
}

function set_order_status(int $orderId, string $status, ?string $note = null): void
{
    q('UPDATE orders SET status = ?, admin_note = COALESCE(?, admin_note) WHERE id = ? AND status <> \'paid\'', [$status, $note, $orderId]);
}

/** Only one webhook delivery per provider event id is processed. */
function webhook_seen(string $provider, string $eventId): bool
{
    try {
        q('INSERT INTO webhook_events (provider, event_id, created_at) VALUES (?, ?, ?)', [$provider, $eventId, now_utc()]);
        return false;
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            return true;
        }
        throw $e;
    }
}

function order_status_label(string $status): array
{
    return match ($status) {
        'paid'            => ['Paid', 'green'],
        'awaiting_review' => ['Under review', 'amber'],
        'pending'         => ['Pending', 'gray'],
        'rejected'        => ['Rejected', 'red'],
        'failed'          => ['Failed', 'red'],
        'cancelled'       => ['Cancelled', 'gray'],
        default           => [ucfirst($status), 'gray'],
    };
}
