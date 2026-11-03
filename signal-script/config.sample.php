<?php
// install.php creates config.php automatically. Use this only for a manual install:
// copy to config.php, fill in, then import inc/schema.sql with phpMyAdmin.
return [
    'base_url' => 'https://yourdomain.com',   // no trailing slash; include sub-folder if any
    'debug' => false,                         // true shows detailed errors (never on a live site)
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => 'u123456789_signals',
        'user' => 'u123456789_admin',
        'pass' => 'your-db-password',
    ],
];
