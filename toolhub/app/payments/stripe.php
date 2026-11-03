<?php
declare(strict_types=1);

// Stripe Checkout — https://docs.stripe.com/payments/checkout

function stripe_api(string $method, string $path, ?array $form = null): array
{
    $r = http_request($method, 'https://api.stripe.com/v1' . $path, [
        'Authorization' => 'Bearer ' . config('payments.stripe.secret_key'),
        'Content-Type'  => 'application/x-www-form-urlencoded',
    ], $form !== null ? http_build_query($form) : null);
    return is_array($r['json']) ? $r['json'] : [];
}

function stripe_start(array $order, array $user): string
{
    $s = stripe_api('POST', '/checkout/sessions', [
        'mode'                => 'payment',
        'client_reference_id' => (string) $order['id'],
        'customer_email'      => $user['email'],
        'metadata'            => ['order_id' => (string) $order['id']],
        'line_items'          => [[
            'quantity'   => 1,
            'price_data' => [
                'currency'     => 'usd',
                'unit_amount'  => (int) round((float) $order['amount'] * 100),
                'product_data' => ['name' => config('app.name') . ' — ' . $order['package_name']],
            ],
        ]],
        'success_url' => gateway_return_url('stripe') . '?session_id={CHECKOUT_SESSION_ID}',
        'cancel_url'  => url('orders/' . $order['id']),
    ]);
    if (empty($s['id']) || empty($s['url'])) {
        error_log('Stripe session failed: ' . json_encode($s));
        throw new PaymentError('Could not start card payment: ' . ($s['error']['message'] ?? 'unknown error'));
    }
    set_order_ref((int) $order['id'], (string) $s['id']);
    return (string) $s['url'];
}

function stripe_fulfill_session(array $s): ?int
{
    $order = !empty($s['id']) ? find_order_by_ref('stripe', (string) $s['id']) : null;
    if (!$order) {
        return null;
    }
    if (($s['payment_status'] ?? '') === 'paid') {
        fulfill_order((int) $order['id'], number_format(((int) $s['amount_total']) / 100, 2, '.', ''), (string) $s['currency'], (string) ($s['payment_intent'] ?? ''));
    }
    return (int) $order['id'];
}

function stripe_return(): ?int
{
    $sid = (string) ($_GET['session_id'] ?? '');
    if (!preg_match('/^cs_[A-Za-z0-9_]+$/', $sid)) {
        return null;
    }
    // Fetch the session from Stripe ourselves — the URL alone proves nothing.
    return stripe_fulfill_session(stripe_api('GET', '/checkout/sessions/' . $sid));
}

function stripe_webhook(): never
{
    $payload = (string) file_get_contents('php://input');
    $secret  = (string) config('payments.stripe.webhook_secret');
    if ($secret === '' || !stripe_signature_valid($payload, (string) ($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? ''), $secret)) {
        json_out(['error' => 'invalid signature'], 400);
    }
    $event = json_decode($payload, true);
    if (!is_array($event) || webhook_seen('stripe', (string) ($event['id'] ?? ''))) {
        json_out(['ok' => true]);
    }
    if (in_array($event['type'] ?? '', ['checkout.session.completed', 'checkout.session.async_payment_succeeded'], true)) {
        stripe_fulfill_session((array) $event['data']['object']);
    }
    json_out(['ok' => true]);
}

function stripe_signature_valid(string $payload, string $header, string $secret, int $tolerance = 300): bool
{
    $ts = null;
    $sigs = [];
    foreach (explode(',', $header) as $part) {
        [$k, $v] = array_pad(explode('=', trim($part), 2), 2, '');
        if ($k === 't') {
            $ts = (int) $v;
        } elseif ($k === 'v1') {
            $sigs[] = $v;
        }
    }
    if (!$ts || !$sigs || abs(time() - $ts) > $tolerance) {
        return false;
    }
    $expected = hash_hmac('sha256', $ts . '.' . $payload, $secret);
    foreach ($sigs as $sig) {
        if (hash_equals($expected, $sig)) {
            return true;
        }
    }
    return false;
}
