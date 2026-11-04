<?php
declare(strict_types=1);

/*
 * Payment gateways.
 *
 * Security rules every gateway follows:
 *  - The amount is always computed on the server from the package price.
 *  - An order is only marked paid after the server itself confirms the
 *    payment with the provider (API call or verified signature) — never
 *    because the browser came back to a "success" URL.
 *  - The confirmed amount + currency must match the order (fulfill_order()).
 *  - fulfill_order() is idempotent, so a webhook and a return page can both
 *    arrive without crediting twice.
 */

require __DIR__ . '/stripe.php';
require __DIR__ . '/paypal.php';
require __DIR__ . '/nowpayments.php';
require __DIR__ . '/binancepay.php';

final class PaymentError extends RuntimeException {}

function gateway_configured(string $code): bool
{
    $c = (array) config('payments.' . $code, []);
    return match ($code) {
        'stripe'      => !empty($c['secret_key']),
        'paypal'      => !empty($c['client_id']) && !empty($c['secret']),
        'nowpayments' => !empty($c['api_key']) && !empty($c['ipn_secret']),
        'binancepay'  => !empty($c['api_key']) && !empty($c['secret_key']),
        default       => false,
    };
}

/** Start an automatic payment and return the URL to send the customer to. */
function gateway_start(array $order, array $user): string
{
    return match ($order['method_code']) {
        'stripe'      => stripe_start($order, $user),
        'paypal'      => paypal_start($order, $user),
        'nowpayments' => nowpayments_start($order, $user),
        'binancepay'  => binancepay_start($order, $user),
        default       => throw new PaymentError('Unknown payment method.'),
    };
}

/** Customer returns from the gateway. Returns the order id to show. */
function gateway_return(string $code): ?int
{
    if (!gateway_configured($code)) {
        return null;
    }
    return match ($code) {
        'stripe'      => stripe_return(),
        'paypal'      => paypal_return(),
        'nowpayments' => nowpayments_return(),
        'binancepay'  => binancepay_return(),
        default       => null,
    };
}

/** Server-to-server notification from the gateway. */
function gateway_webhook(string $code): never
{
    // A gateway without keys must never accept notifications (an empty
    // secret would make signatures trivially forgeable).
    if (!gateway_configured($code)) {
        json_out(['error' => 'not found'], 404);
    }
    match ($code) {
        'stripe'      => stripe_webhook(),
        'nowpayments' => nowpayments_webhook(),
        'binancepay'  => binancepay_webhook(),
        default       => json_out(['error' => 'not found'], 404),
    };
}

function gateway_return_url(string $code, array $extra = []): string
{
    return url('pay/' . $code . '/return', $extra);
}

function gateway_webhook_url(string $code): string
{
    return url('pay/' . $code . '/webhook');
}

/** Our own invoice reference sent to gateways, e.g. TH000123. */
function invoice_no(array $order): string
{
    return 'TH' . str_pad((string) $order['id'], 6, '0', STR_PAD_LEFT);
}

function order_id_from_invoice(string $invoice): ?int
{
    return preg_match('/^TH(\d{6,})$/', $invoice, $m) ? (int) $m[1] : null;
}
