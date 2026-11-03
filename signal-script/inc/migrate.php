<?php
declare(strict_types=1);

const DB_VERSION = 3;

/** Brings an existing database up to the current schema. Safe to run many times. */
function run_migrations(): void
{
    $sql = (string)file_get_contents(APP_ROOT . '/inc/schema.sql');
    $sql = preg_replace('/^--.*$/m', '', $sql) ?? '';
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
        db()->exec($stmt); // all CREATE TABLE IF NOT EXISTS
    }
    $columns = [
        'payments' => [
            'original_amount' => 'DECIMAL(10,2) NULL',
            'coupon_code' => 'VARCHAR(40) NULL',
            'gateway' => "VARCHAR(30) NOT NULL DEFAULT 'manual'",
            'gateway_ref' => 'VARCHAR(190) NULL',
        ],
        'users' => [
            'expiry_reminded' => 'TINYINT(1) NOT NULL DEFAULT 0',
        ],
    ];
    foreach ($columns as $table => $cols) {
        $have = array_column(q("SHOW COLUMNS FROM `$table`")->fetchAll(), 'Field');
        foreach ($cols as $col => $def) {
            if (!in_array($col, $have, true)) {
                db()->exec("ALTER TABLE `$table` ADD COLUMN `$col` $def");
            }
        }
    }
    save_setting('db_version', (string)DB_VERSION);
}

function maybe_migrate(): void
{
    if ((int)setting('db_version', '1') < DB_VERSION) {
        run_migrations();
        settings_all(true);
    }
}
