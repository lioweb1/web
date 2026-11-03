<?php
declare(strict_types=1);
/**
 * Signal engine runner.
 *   CLI (recommended, Hostinger hPanel → Cron Jobs, every minute):
 *       php /home/USER/public_html/cron.php
 *   URL (external cron services):
 *       https://yourdomain.com/cron.php?key=YOUR_CRON_KEY
 */
require __DIR__ . '/inc/bootstrap.php';
require __DIR__ . '/inc/engine.php';

if (PHP_SAPI !== 'cli') {
    $key = (string)($_GET['key'] ?? '');
    if (setting('cron_key') === '' || !hash_equals(setting('cron_key'), $key)) {
        http_response_code(403);
        exit('Forbidden');
    }
    header('Content-Type: text/plain; charset=utf-8');
}

// Simple lock so overlapping runs don't create duplicate signals
$lock = fopen(APP_ROOT . '/storage/cron.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    exit("Another run is in progress.\n");
}
set_time_limit(110);

$engine = new SignalEngine();
$r = $engine->run();
echo gmdate('Y-m-d H:i:s') . " UTC — created: {$r['created']}, closed: {$r['closed']}, telegram: {$r['telegram']}\n";
foreach ($engine->messages() as $m) {
    echo $m . "\n";
}
flock($lock, LOCK_UN);
