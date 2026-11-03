<?php
declare(strict_types=1);

// bKash Tokenized Checkout — https://developer.bka.sh

function bkash_base(): string
{
    return config('payments.bkash.sandbox', true)
        ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout'
        : 'https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout';
}

function bkash_token(): string
{
    // Grant tokens are valid for ~1 hour; cache in the session-independent storage dir.
    $cache = APP_DIR . '/storage/bkash_token.json';
    if (is_file($cache)) {
        $c = json_decode((string) file_get_contents($cache), true);
        if (is_array($c) && ($c['exp'] ?? 0) > time() + 60 && !empty($c['token'])) {
            return $c['token'];
        }
    }
    $r = http_request('POST', bkash_base() . '/token/grant', [
        'Content-Type' => 'application/json',
        'Accept'       => 'application/json',
        'username'     => (string) config('payments.bkash.username'),
        'password'     => (string) config('payments.bkash.password'),
    ], json_encode([
        'app_key'    => (string) config('payments.bkash.app_key'),
        'app_secret' => (string) config('payments.bkash.app_secret'),
    ]));
    $token = $r['json']['id_token'] ?? '';
    if ($token === '') {
        error_log('bKash grant failed: ' . $r['body']);
        throw new PaymentError('bKash is not available right now. Please try another method.');
    }
    $ttl = (int) ($r['json']['expires_in'] ?? 3600);
    @file_put_contents($cache, json_encode(['token' => $token, 'exp' => time() + $ttl]), LOCK_EX);
    @chmod($cache, 0600);
    return $token;
}

function bkash_call(string $path, array $body): array
{
    $r = http_request('POST', bkash_base() . $path, [
        'Content-Type'  => 'application/json',
        'Accept'        => 'application/json',
        'Authorization' => bkash_token(),
        'X-APP-Key'     => (string) config('payments.bkash.app_key'),
    ], json_encode($body), 60);
    return is_array($r['json']) ? $r['json'] : [];
}

function bkash_start(array $order, array $user): string
{
    $res = bkash_call('/create', [
        'mode'                  => '0011',
        'payerReference'        => (string) $user['id'],
        'callbackURL'           => gateway_return_url('bkash'),
        'amount'                => $order['amount'],
        'currency'              => 'BDT',
        'intent'                => 'sale',
        'merchantInvoiceNumber' => invoice_no($order),
    ]);
    if (($res['statusCode'] ?? '') !== '0000' || empty($res['bkashURL']) || empty($res['paymentID'])) {
        error_log('bKash create failed: ' . json_encode($res));
        throw new PaymentError('Could not start bKash payment: ' . ($res['statusMessage'] ?? 'unknown error'));
    }
    set_order_ref((int) $order['id'], (string) $res['paymentID']);
    return (string) $res['bkashURL'];
}

function bkash_return(): ?int
{
    $paymentId = (string) ($_GET['paymentID'] ?? '');
    $status    = (string) ($_GET['status'] ?? '');
    $order = $paymentId !== '' ? find_order_by_ref('bkash', $paymentId) : null;
    if (!$order) {
        return null;
    }
    if ($status !== 'success') {
        set_order_status((int) $order['id'], $status === 'cancel' ? 'cancelled' : 'failed');
        return (int) $order['id'];
    }

    $res = bkash_call('/execute', ['paymentID' => $paymentId]);
    if (($res['transactionStatus'] ?? '') !== 'Completed') {
        // Execute can time out or be repeated; ask bKash for the real status.
        $res = bkash_call('/payment/status', ['paymentID' => $paymentId]);
    }
    if (($res['transactionStatus'] ?? '') === 'Completed'
        && ($res['merchantInvoiceNumber'] ?? '') === invoice_no($order)) {
        fulfill_order((int) $order['id'], (string) $res['amount'], (string) ($res['currency'] ?? 'BDT'), (string) ($res['trxID'] ?? ''));
    } else {
        error_log('bKash not completed: ' . json_encode($res));
        set_order_status((int) $order['id'], 'failed');
    }
    return (int) $order['id'];
}
