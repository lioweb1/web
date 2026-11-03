<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title><?= e(setting('site_name')) ?> · Maintenance</title>
<link rel="stylesheet" href="<?= asset('css/style.css') ?>"><style>:root{--primary:<?= e(setting('primary_color')) ?>}</style></head>
<body><section class="section"><div class="container center" style="padding-top:12vh">
<div class="brand" style="justify-content:center"><span class="brand-mark">▲</span><?= e(setting('site_name')) ?></div>
<h1 class="mt">We'll be right back</h1><p class="lead" style="margin:0 auto"><?= e(setting('maintenance_text')) ?></p>
<?php if (setting('social_telegram')): ?><p class="mt"><a class="btn btn-primary" href="<?= e(setting('social_telegram')) ?>">Follow us on Telegram</a></p><?php endif; ?>
</div></section></body></html>
