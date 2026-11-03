<?php
declare(strict_types=1);

define('APP_DIR', __DIR__);

if (!is_file(APP_DIR . '/config.php')) {
    http_response_code(500);
    exit('ToolHub is not configured yet: copy app/config.sample.php to app/config.php and fill it in.');
}
$GLOBALS['__config'] = require APP_DIR . '/config.php';

if (is_file(APP_DIR . '/vendor/autoload.php')) {
    require APP_DIR . '/vendor/autoload.php';
}

require APP_DIR . '/lib/core.php';
require APP_DIR . '/lib/auth.php';
require APP_DIR . '/lib/credits.php';
require APP_DIR . '/lib/orders.php';
require APP_DIR . '/lib/tools.php';
require APP_DIR . '/payments/gateways.php';

date_default_timezone_set(config('app.timezone', 'UTC'));

$debug = (bool) config('app.debug', false);
error_reporting(E_ALL);
ini_set('display_errors', $debug ? '1' : '0');
ini_set('log_errors', '1');
ini_set('error_log', APP_DIR . '/storage/error.log');

set_exception_handler(static function (Throwable $e) use ($debug): void {
    error_log((string) $e);
    if (!headers_sent()) {
        http_response_code(500);
    }
    echo $debug
        ? '<pre>' . h((string) $e) . '</pre>'
        : 'Something went wrong. Please try again later.';
});

start_secure_session();
send_security_headers();
