<?php
$navItems = [
    'dashboard' => ['📊', 'Dashboard'],
    'signals' => ['📈', 'Signals'],
    'payments' => ['💳', 'Payments'],
    'users' => ['👥', 'Users'],
    'subscribers' => ['✉️', 'Email list'],
    'posts' => ['📝', 'Blog posts'],
    'pages' => ['📄', 'Pages'],
    'brokers' => ['🤝', 'Affiliate brokers'],
    'clicks' => ['🖱️', 'Affiliate clicks'],
    'plans' => ['⭐', 'Premium plans'],
    'coupons' => ['🏷️', 'Coupons'],
    'testimonials' => ['💬', 'Testimonials'],
    'faqs' => ['❓', 'FAQ'],
    'chat' => ['✨', 'AI chat'],
    'backup' => ['💾', 'Backup'],
    'media' => ['🖼️', 'Media'],
    'settings' => ['⚙️', 'Settings'],
    'log' => ['🧾', 'Engine log'],
];
$pending = (int)q_val("SELECT COUNT(*) FROM payments WHERE status = 'pending'");
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title><?= e($title ?? 'Admin') ?> · <?= e(setting('site_name')) ?> Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="<?= asset('css/admin.css') ?>">
<style>:root{--primary:<?= e(setting('primary_color', '#22c55e')) ?>}</style>
</head>
<body>
<aside class="sidebar">
  <a class="brand" href="<?= e(admin_url()) ?>">▲ <?= e(setting('site_name')) ?></a>
  <nav>
    <?php foreach ($navItems as $k => [$icon, $label]): ?>
      <a href="<?= e(admin_url($k)) ?>" class="<?= $a === $k ? 'active' : '' ?>"><span><?= $icon ?></span><?= e($label) ?><?php if ($k === 'payments' && $pending): ?><b class="count"><?= $pending ?></b><?php endif; ?></a>
    <?php endforeach; ?>
  </nav>
  <div class="side-foot">
    <a href="<?= e(url()) ?>" target="_blank">↗ View site</a>
    <a href="<?= e(url('dashboard')) ?>">My account</a>
    <form method="post" action="<?= e(url('logout')) ?>"><?= csrf_field() ?><button>Log out</button></form>
  </div>
</aside>
<div class="main">
  <header class="topbar">
    <button class="menu-btn" onclick="document.body.classList.toggle('side-open')">☰</button>
    <h1><?= e($title ?? '') ?></h1>
  </header>
  <div class="page">
    <?php foreach (flashes() as $f): ?><div class="alert alert-<?= e($f['type']) ?>"><?= e($f['msg']) ?></div><?php endforeach; ?>
    <?= $content ?>
  </div>
</div>
<script>window.ADMIN = {media: <?= json_encode(admin_url('media', ['json' => 1])) ?>, csrf: <?= json_encode(csrf_token()) ?>};</script>
<script src="<?= asset('js/admin.js') ?>"></script>
</body>
</html>
