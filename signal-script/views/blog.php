<section class="section">
  <div class="container">
    <div class="section-head"><div><h1>Market Analysis & Blog</h1><p class="muted">Strategies, forecasts and trading education.</p></div></div>
    <?php if ($cats): ?>
      <div class="tabs wrap">
        <a class="<?= $cat === '' ? 'active' : '' ?>" href="<?= e(url('blog')) ?>">All</a>
        <?php foreach ($cats as $c): ?><a class="<?= $cat === $c['category'] ? 'active' : '' ?>" href="<?= e(url('blog') . '?cat=' . rawurlencode($c['category'])) ?>"><?= e($c['category']) ?> (<?= (int)$c['n'] ?>)</a><?php endforeach; ?>
      </div>
    <?php endif; ?>
    <?php if (!$posts): ?><div class="empty big">No posts yet.</div><?php else: ?>
      <div class="post-grid"><?php foreach ($posts as $p) include __DIR__ . '/partials/post_card.php'; ?></div>
      <?= $pager ?>
    <?php endif; ?>
  </div>
</section>
