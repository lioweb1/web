<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= h((isset($title) ? $title . ' · ' : '') . config('app.name')) ?></title>
  <link rel="stylesheet" href="<?= h(asset('app.css')) ?>">
</head>
<body class="guest">
  <header class="guest-top">
    <a class="brand" href="<?= h(url('')) ?>"><span class="brand-mark">◆</span> <?= h(config('app.name')) ?></a>
    <nav>
      <?php if (current_user()): ?>
        <a class="btn btn-primary" href="<?= h(url('dashboard')) ?>">Dashboard</a>
      <?php else: ?>
        <a href="<?= h(url('login')) ?>">Log in</a>
        <a class="btn btn-primary" href="<?= h(url('register')) ?>">Get started</a>
      <?php endif; ?>
    </nav>
  </header>
  <main class="guest-main">
    <?php require __DIR__ . '/partials/flash.php'; ?>
    <?= $content ?>
  </main>
  <footer class="guest-foot">© <?= date('Y') ?> <?= h(config('app.name')) ?> · <a href="mailto:<?= h(config('app.support_email')) ?>"><?= h(config('app.support_email')) ?></a></footer>
  <script src="<?= h(asset('app.js')) ?>"></script>
</body>
</html>
