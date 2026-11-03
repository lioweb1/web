<?php
declare(strict_types=1);

// Binance Pay merchant API — https://developers.binance.com/docs/binance-pay

function binancepay_call(string $path, array $body): array
{
    $json  = json_encode($body, JSON_UNESCAPED_SLASHES);
    $ts    = (string) (int) round(microtime(true) * 1000);
    $nonce = bin2hex(random_bytes(16));
    $sig   = strtoupper(hash_hmac('sha512', $ts . "\n" . $nonce . "\n" . $json . "\n", (string) config('payments.binancepay.secret_key')));
    $r = http_request('POST', 'https://bpay.binanceapi.com' . $path, [
        'Content-Type'              => 'application/json',
        'BinancePay-Timestamp'      => $ts,
        'BinancePay-Nonce'          => $nonce,
        'BinancePay-Certificate-SN' => (string) config('payments.binancepay.api_key'),
        'BinancePay-Signature'      => $sig,
    ], $json);
    return is_array($r['json']) ? $r['json'] : [];
}

function binancepay_start(array $order, array $user): string
{
    $res = binancepay_call('/binancepay/openapi/v3/order', [
        'env'             => ['terminalType' => 'WEB'],
        'merchantTradeNo' => invoice_no($order),
        'orderAmount'     => (float) $order['amount'],
        'currency'        => 'USDT',
        'description'     => config('app.name') . ' ' . $order['package_name'],
        'goodsDetails'    => [[
            'goodsType'        => '02',
            'goodsCategory'    => 'Z000',
            'referenceGoodsId' => (string) $order['package_id'],
            'goodsName'        => $order['package_name'],
        ]],
        'returnUrl'  => gateway_return_url('binancepay', ['o' => $order['id']]),
        'cancelUrl'  => url('orders/' . $order['id']),
        'webhookUrl' => gateway_webhook_url('binancepay'),
    ]);
    if (($res['status'] ?? '') !== 'SUCCESS' || empty($res['data']['checkoutUrl'])) {
        error_log('Binance Pay create failed: ' . json_encode($res));
        throw new PaymentError('Could not start Binance Pay: ' . ($res['errorMessage'] ?? 'unknown error'));
    }
    set_order_ref((int) $order['id'], (string) $res['data']['prepayId']);
    return (string) $res['data']['checkoutUrl'];
}

/** Ask Binance for the real order status and fulfil if paid. */
function binancepay_check(array $order): void
{
    $res = binancepay_call('/binancepay/openapi/v2/order/query', ['merchantTradeNo' => invoice_no($order)]);
    $d = $res['data'] ?? [];
    if (($res['status'] ?? '') === 'SUCCESS' && ($d['status'] ?? '') === 'PAID' && ($d['merchantTradeNo'] ?? '') === invoice_no($order)) {
        fulfill_order((int) $order['id'], (string) $d['orderAmount'], (string) $d['currency'], (string) ($d['transactionId'] ?? ''));
    } elseif (in_array($d['status'] ?? '', ['CANCELED', 'EXPIRED', 'ERROR'], true)) {
        set_order_status((int) $order['id'], 'failed');
    }
}

function binancepay_return(): ?int
{
    $order = find_order((int) ($_GET['o'] ?? 0));
    if (!$order || $order['method_code'] !== 'binancepay') {
        return null;
    }
    binancepay_check($order);
    return (int) $order['id'];
}

/**
 * Webhook: we don't trust its body. We only use it as a signal and then
 * query Binance with our own signed request.
 */
function binancepay_webhook(): never
{
    $data = json_decode((string) file_get_contents('php://input'), true);
    $inner = is_array($data) ? json_decode((string) ($data['data'] ?? ''), true) : null;
    $orderId = order_id_from_invoice((string) ($inner['merchantTradeNo'] ?? ''));
    $order = $orderId ? find_order($orderId) : null;
    if ($order && $order['method_code'] === 'binancepay') {
        binancepay_check($order);
    }
    json_out(['returnCode' => 'SUCCESS', 'returnMessage' => null]);
}
