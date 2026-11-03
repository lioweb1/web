<?php
declare(strict_types=1);

define('APP_ROOT', dirname(__DIR__));
define('APP_VERSION', '1.0.0');
date_default_timezone_set('UTC');

if (!is_file(APP_ROOT . '/config.php')) {
    if (PHP_SAPI === 'cli') {
        fwrite(STDERR, "Not installed. Open install.php in your browser first.\n");
        exit(1);
    }
    $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    if (str_ends_with($base, '/admin')) {
        $base = substr($base, 0, -6);
    }
    header('Location: ' . $base . '/install.php');
    exit;
}

$CONFIG = require APP_ROOT . '/config.php';
define('BASE_URL', rtrim((string)$CONFIG['base_url'], '/'));
define('APP_DEBUG', !empty($CONFIG['debug']));

ini_set('display_errors', APP_DEBUG ? '1' : '0');
error_reporting(E_ALL);

require APP_ROOT . '/inc/functions.php';
require APP_ROOT . '/inc/migrate.php';
require APP_ROOT . '/inc/ai.php';

set_exception_handler(function (Throwable $e) {
    error_log('[signal-script] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (PHP_SAPI === 'cli') {
        fwrite(STDERR, $e->getMessage() . "\n");
        exit(1);
    }
    http_response_code(500);
    echo '<!doctype html><meta charset="utf-8"><title>Error</title><body style="font-family:sans-serif;background:#0b1220;color:#e5e7eb;padding:40px">';
    echo '<h1>Something went wrong</h1>';
    echo APP_DEBUG ? '<pre>' . htmlspecialchars((string)$e) . '</pre>' : '<p>Please try again later.</p>';
    exit;
});

maybe_migrate();

if (PHP_SAPI !== 'cli') {
    start_session();
}
