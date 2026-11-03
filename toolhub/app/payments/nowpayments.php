<?php
declare(strict_types=1);

// NOWPayments crypto invoices — https://documenter.getpostman.com/view/7907941/2s93JusNJt

function nowpayments_base(): string
{
    return config('payments.nowpayments.sandbox', false) ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1';
}

function nowpayments_start(array $order, array $user): string
{
    $r = http_request('POST', nowpayments_base() . '/invoice', [
        'x-api-key'    => (string) config('payments.nowpayments.api_key'),
        'Content-Type' => 'application/json',
    ], json_encode([
        'price_amount'      => (float) $order['amount'],
        'price_currency'    => 'usd',
        'order_id'          => invoice_no($order),
        'order_description' => config('app.name') . ' — ' . $order['package_name'],
        'ipn_callback_url'  => gateway_webhook_url('nowpayments'),
        'success_url'       => gateway_return_url('nowpayments', ['o' => $order['id']]),
        'cancel_url'        => url('orders/' . $order['id']),
    ]));
    $j = $r['json'] ?? [];
    if (empty($j['id']) || empty($j['invoice_url'])) {
        error_log('NOWPayments invoice failed: ' . $r['body']);
        throw new PaymentError('Could not start crypto payment.');
    }
    set_order_ref((int) $order['id'], (string) $j['id']);
    return (string) $j['invoice_url'];
}

/** The return page only shows the order; crypto confirmations arrive later via IPN. */
function nowpayments_return(): ?int
{
    return (int) ($_GET['o'] ?? 0) ?: null;
}

function nowpayments_sort(array $a): array
{
    ksort($a);
    foreach ($a as $k => $v) {
        if (is_array($v)) {
            $a[$k] = nowpayments_sort($v);
        }
    }
    return $a;
}

function nowpayments_webhook(): never
{
    $raw = (string) file_get_contents('php://input');
    $data = json_decode($raw, true);
    $sig = (string) ($_SERVER['HTTP_X_NOWPAYMENTS_SIG'] ?? '');
    if (!is_array($data) || $sig === '') {
        json_out(['error' => 'bad request'], 400);
    }
    $expected = hash_hmac('sha512', json_encode(nowpayments_sort($data), JSON_UNESCAPED_SLASHES), (string) config('payments.nowpayments.ipn_secret'));
    if (!hash_equals($expected, $sig)) {
        json_out(['error' => 'invalid signature'], 400);
    }

    $orderId = order_id_from_invoice((string) ($data['order_id'] ?? ''));
    $order = $orderId ? find_order($orderId) : null;
    if (!$order || $order['method_code'] !== 'nowpayments') {
        json_out(['ok' => true]);
    }
    $status = (string) ($data['payment_status'] ?? '');
    if ($status === 'finished') {
        // price_amount/price_currency are the fiat values of the invoice we created.
        fulfill_order($orderId, (string) $data['price_amount'], (string) $data['price_currency'], (string) ($data['payment_id'] ?? ''));
    } elseif (in_array($status, ['failed', 'expired'], true)) {
        set_order_status($orderId, 'failed');
    } elseif ($status === 'partially_paid') {
        set_order_status($orderId, 'awaiting_review', 'Crypto partially paid — check NOWPayments dashboard.');
    }
    json_out(['ok' => true]);
}
