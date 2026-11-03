<?php
declare(strict_types=1);

// Find the private "app" folder. Recommended: put it OUTSIDE public_html
// (e.g. /home/youruser/toolhub_app) so nobody can download it from the web.
$appDir = null;
foreach ([__DIR__ . '/../toolhub_app', __DIR__ . '/../app', __DIR__ . '/app'] as $dir) {
    if (is_file($dir . '/bootstrap.php')) {
        $appDir = $dir;
        break;
    }
}
if ($appDir === null) {
    http_response_code(500);
    exit('ToolHub: app folder not found. See README.md (Installation).');
}

require $appDir . '/bootstrap.php';
require $appDir . '/routes.php';

dispatch();
