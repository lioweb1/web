<?php
declare(strict_types=1);

// PayPal Orders v2 — https://developer.paypal.com/docs/api/orders/v2/

function paypal_base(): string
{
    return config('payments.paypal.sandbox', true) ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
}

function paypal_token(): string
{
    $r = http_request('POST', paypal_base() . '/v1/oauth2/token', [
        'Authorization' => 'Basic ' . base64_encode(config('payments.paypal.client_id') . ':' . config('payments.paypal.secret')),
        'Content-Type'  => 'application/x-www-form-urlencoded',
    ], 'grant_type=client_credentials');
    $t = $r['json']['access_token'] ?? '';
    if ($t === '') {
        error_log('PayPal token failed: ' . $r['body']);
        throw new PaymentError('PayPal is not available right now. Please try another method.');
    }
    return $t;
}

function paypal_api(string $method, string $path, ?array $body = null): array
{
    $r = http_request($method, paypal_base() . $path, [
        'Authorization' => 'Bearer ' . paypal_token(),
        'Content-Type'  => 'application/json',
    ], $body !== null ? json_encode($body) : '{}');
    return is_array($r['json']) ? $r['json'] : [];
}

function paypal_start(array $order, array $user): string
{
    $res = paypal_api('POST', '/v2/checkout/orders', [
        'intent' => 'CAPTURE',
        'purchase_units' => [[
            'reference_id' => invoice_no($order),
            'custom_id'    => (string) $order['id'],
            'description'  => config('app.name') . ' — ' . $order['package_name'],
            'amount'       => ['currency_code' => 'USD', 'value' => $order['amount']],
        ]],
        'payment_source' => ['paypal' => ['experience_context' => [
            'brand_name'          => (string) config('app.name'),
            'shipping_preference' => 'NO_SHIPPING',
            'user_action'         => 'PAY_NOW',
            'return_url'          => gateway_return_url('paypal'),
            'cancel_url'          => url('orders/' . $order['id']),
        ]]],
    ]);
    $approve = '';
    foreach ((array) ($res['links'] ?? []) as $l) {
        if (in_array($l['rel'] ?? '', ['payer-action', 'approve'], true)) {
            $approve = (string) $l['href'];
        }
    }
    if (empty($res['id']) || $approve === '') {
        error_log('PayPal create failed: ' . json_encode($res));
        throw new PaymentError('Could not start PayPal payment.');
    }
    set_order_ref((int) $order['id'], (string) $res['id']);
    return $approve;
}

function paypal_return(): ?int
{
    $ppId = (string) ($_GET['token'] ?? '');
    if (!preg_match('/^[A-Z0-9]{5,40}$/', $ppId)) {
        return null;
    }
    $order = find_order_by_ref('paypal', $ppId);
    if (!$order) {
        return null;
    }
    $res = paypal_api('POST', '/v2/checkout/orders/' . $ppId . '/capture');
    if (($res['details'][0]['issue'] ?? '') === 'ORDER_ALREADY_CAPTURED') {
        $res = paypal_api('GET', '/v2/checkout/orders/' . $ppId);
    }
    $unit = $res['purchase_units'][0] ?? [];
    $capture = $unit['payments']['captures'][0] ?? [];
    if (($res['status'] ?? '') === 'COMPLETED'
        && ($capture['status'] ?? '') === 'COMPLETED'
        && (string) ($capture['custom_id'] ?? $unit['custom_id'] ?? '') === (string) $order['id']) {
        fulfill_order((int) $order['id'], (string) $capture['amount']['value'], (string) $capture['amount']['currency_code'], (string) $capture['id']);
    } else {
        error_log('PayPal capture not completed: ' . json_encode($res));
    }
    return (int) $order['id'];
}
