<?php
$me = current_user(true); // fresh: credits may have changed during this request
$path = request_path();
$nav = [
    ['dashboard', 'Dashboard', '🏠'],
    ['tools', 'Tools List', '🧰'],
    ['plans', 'Buy Plan / Credits', '💳'],
    ['orders', 'Payment History', '🧾'],
    ['history', 'Usage History', '🕘'],
    ['account', 'Account Settings', '⚙️'],
];
$adminNav = [
    ['admin', 'Overview', '📊'],
    ['admin/payments', 'Payments', '✅'],
    ['admin/users', 'Users', '👥'],
    ['admin/tools', 'Tools', '🛠️'],
    ['admin/packages', 'Packages', '📦'],
    ['admin/methods', 'Payment Methods', '🏦'],
];
$active = fn (string $p) => $path === $p || ($p !== 'admin' && str_starts_with($path, $p . '/')) ? 'active' : '';
$initials = strtoupper(mb_substr($me['name'] ?? 'U', 0, 2));
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= h(($title ?? '') . ' · ' . config('app.name')) ?></title>
  <link rel="stylesheet" href="<?= h(asset('app.css')) ?>">
</head>
<body class="app">
  <header class="topbar">
    <button class="icon-btn" type="button" data-toggle-sidebar aria-label="Menu">☰</button>
    <a class="brand" href="<?= h(url('dashboard')) ?>"><span class="brand-mark">◆</span> <?= h(config('app.name')) ?></a>
    <div class="topbar-right">
      <a class="credit-pill" href="<?= h(url('plans')) ?>" title="Your credits"><?= number_format((int) $me['credits']) ?> credits</a>
      <span class="avatar" title="<?= h($me['email']) ?>"><?= h($initials) ?></span>
    </div>
  </header>
  <aside class="sidebar" id="sidebar">
    <nav>
      <?php foreach ($nav as [$p, $label, $icon]): ?>
        <a class="nav-link <?= $active($p) ?>" href="<?= h(url($p)) ?>"><span><?= $icon ?></span><?= h($label) ?></a>
      <?php endforeach; ?>
      <?php if ($me['role'] === 'admin'): ?>
        <div class="nav-title">Admin</div>
        <?php foreach ($adminNav as [$p, $label, $icon]): ?>
          <a class="nav-link <?= $active($p) ?>" href="<?= h(url($p)) ?>"><span><?= $icon ?></span><?= h($label) ?></a>
        <?php endforeach; ?>
      <?php endif; ?>
      <form method="post" action="<?= h(url('logout')) ?>"><?= csrf_field() ?>
        <button class="nav-link as-button" type="submit"><span>↩️</span>Logout</button>
      </form>
    </nav>
    <div class="upgrade-box">
      <?php if (plan_active($me)): ?>
        <strong><?= h($me['plan_name'] ?: 'Active plan') ?></strong>
        <p>Valid until <?= h(fmt_time($me['plan_expires_at'])) ?></p>
        <a class="btn btn-primary btn-block" href="<?= h(url('plans')) ?>">Renew / Top-up</a>
      <?php else: ?>
        <strong>Upgrade to a plan</strong>
        <p>Unlock all tools with one monthly plan.</p>
        <a class="btn btn-primary btn-block" href="<?= h(url('plans')) ?>">✦ See Plans</a>
      <?php endif; ?>
    </div>
  </aside>
  <main class="main">
    <?php require __DIR__ . '/partials/flash.php'; ?>
    <?= $content ?>
  </main>
  <script src="<?= h(asset('app.js')) ?>"></script>
</body>
</html>
