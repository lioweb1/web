<?php
declare(strict_types=1);

/**
 * Change a user's credits and write a ledger row, atomically.
 * Must be called inside a transaction when combined with other writes.
 * Returns false if the change would make the balance negative.
 */
function ledger_change(int $userId, int $delta, string $reason, ?string $refType = null, ?int $refId = null): bool
{
    $row = q_one('SELECT credits FROM users WHERE id = ? FOR UPDATE', [$userId]);
    if (!$row) {
        throw new RuntimeException('User not found');
    }
    $new = (int) $row['credits'] + $delta;
    if ($new < 0) {
        return false;
    }
    q('UPDATE users SET credits = ? WHERE id = ?', [$new, $userId]);
    q(
        'INSERT INTO credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$userId, $delta, $new, mb_substr($reason, 0, 191), $refType, $refId, now_utc()]
    );
    return true;
}

/** Run $fn inside a DB transaction. */
function transaction(callable $fn): mixed
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $result = $fn();
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}
