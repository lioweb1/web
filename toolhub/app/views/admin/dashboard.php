<h1 class="page-title">Admin overview</h1>
<?php if ($review): ?><div class="banner"><div><strong><?= (int) $review ?> payment(s) waiting for review</strong></div><a class="btn btn-primary" href="<?= h(url('admin/payments')) ?>">Review now</a></div><?php endif; ?>
<div class="stats">
  <div class="stat"><span>Users</span><strong><?= number_format($users) ?></strong></div>
  <div class="stat"><span>Active plans</span><strong><?= number_format($active) ?></strong></div>
  <div class="stat"><span>Tool runs (30d)</span><strong><?= number_format($runs) ?></strong></div>
  <div class="stat"><span>Revenue (30d)</span><strong><?php if (!$revenue): ?>0<?php endif; ?><?php foreach ($revenue as $r): ?><?= money($r['total'], $r['currency']) ?> <?php endforeach; ?></strong></div>
</div>
<div class="two-col">
  <section class="card">
    <h2>Setup checklist</h2>
    <ul class="checklist"><?php foreach ($checks as [$label, $ok, $fix]): ?>
      <li class="<?= $ok ? 'ok' : 'bad' ?>"><?= $ok ? '✅' : '⚠️' ?> <?= h($label) ?><?php if (!$ok): ?><br><span class="muted small"><?= h($fix) ?></span><?php endif; ?></li>
    <?php endforeach; ?></ul>
  </section>
  <section class="card">
    <h2>Top tools (30 days)</h2>
    <?php if (!$topTools): ?><p class="muted">No usage yet.</p><?php endif; ?>
    <div class="mini-list"><?php foreach ($topTools as $t): ?><div><span><?= h($t['icon']) ?></span><?= h($t['name']) ?><em><?= (int) $t['n'] ?> runs</em></div><?php endforeach; ?></div>
  </section>
</div>
