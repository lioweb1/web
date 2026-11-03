<?php
declare(strict_types=1);

// SSLCommerz — https://developer.sslcommerz.com (cards, Nagad, Rocket, banks in Bangladesh)

function sslcommerz_base(): string
{
    return config('payments.sslcommerz.sandbox', true) ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
}

function sslcommerz_start(array $order, array $user): string
{
    $r = http_request('POST', sslcommerz_base() . '/gwprocess/v4/api.php', [], [
        'store_id'         => (string) config('payments.sslcommerz.store_id'),
        'store_passwd'     => (string) config('payments.sslcommerz.store_password'),
        'total_amount'     => $order['amount'],
        'currency'         => 'BDT',
        'tran_id'          => invoice_no($order),
        'success_url'      => gateway_return_url('sslcommerz'),
        'fail_url'         => gateway_return_url('sslcommerz'),
        'cancel_url'       => gateway_return_url('sslcommerz'),
        'ipn_url'          => gateway_webhook_url('sslcommerz'),
        'cus_name'         => $user['name'],
        'cus_email'        => $user['email'],
        'cus_add1'         => 'N/A',
        'cus_city'         => 'N/A',
        'cus_country'      => 'Bangladesh',
        'cus_phone'        => 'N/A',
        'shipping_method'  => 'NO',
        'num_of_item'      => 1,
        'product_name'     => $order['package_name'],
        'product_category' => 'Digital service',
        'product_profile'  => 'non-physical-goods',
    ]);
    $url = $r['json']['GatewayPageURL'] ?? '';
    if (($r['json']['status'] ?? '') !== 'SUCCESS' || $url === '') {
        error_log('SSLCommerz init failed: ' . $r['body']);
        throw new PaymentError('Could not start card payment: ' . ($r['json']['failedreason'] ?? 'unknown error'));
    }
    set_order_ref((int) $order['id'], invoice_no($order));
    return $url;
}

/** Verify a val_id with SSLCommerz's validation API (never trust the POSTed status). */
function sslcommerz_validate(string $valId): ?int
{
    $r = http_request('GET', sslcommerz_base() . '/validator/api/validationserverAPI.php?' . http_build_query([
        'val_id'       => $valId,
        'store_id'     => (string) config('payments.sslcommerz.store_id'),
        'store_passwd' => (string) config('payments.sslcommerz.store_password'),
        'format'       => 'json',
    ]));
    $v = $r['json'] ?? [];
    $orderId = order_id_from_invoice((string) ($v['tran_id'] ?? ''));
    if (!$orderId) {
        return null;
    }
    if (in_array($v['status'] ?? '', ['VALID', 'VALIDATED'], true)) {
        fulfill_order($orderId, (string) $v['currency_amount'], (string) $v['currency_type'], (string) ($v['bank_tran_id'] ?? $valId));
    }
    return $orderId;
}

function sslcommerz_return(): ?int
{
    $valId = (string) ($_POST['val_id'] ?? '');
    if ($valId !== '') {
        return sslcommerz_validate($valId);
    }
    $orderId = order_id_from_invoice((string) ($_POST['tran_id'] ?? ''));
    if ($orderId) {
        $order = find_order($orderId);
        if ($order && $order['method_code'] === 'sslcommerz') {
            set_order_status($orderId, ($_POST['status'] ?? '') === 'CANCELLED' ? 'cancelled' : 'failed');
        }
    }
    return $orderId;
}

function sslcommerz_webhook(): never
{
    $valId = (string) ($_POST['val_id'] ?? '');
    if ($valId !== '') {
        sslcommerz_validate($valId);
    }
    json_out(['ok' => true]);
}
