<?php $me = current_user(); ?>
<h1 class="page-title">Hi, <?= h($me['name']) ?> 👋</h1>
<?php if (!plan_active($me)): ?>
  <div class="banner">
    <div><strong>You don't have an active plan.</strong><br><span class="muted">Buy a plan to unlock all tools.</span></div>
    <a class="btn btn-primary" href="<?= h(url('plans')) ?>">See plans</a>
  </div>
<?php endif; ?>
<?php if ($pending): ?>
  <div class="alert alert-info"><?= (int) $pending ?> payment(s) are being reviewed. Credits will be added once verified.</div>
<?php endif; ?>
<div class="stats">
  <div class="stat"><span>Credits</span><strong><?= number_format((int) $me['credits']) ?></strong></div>
  <div class="stat"><span>Plan</span><strong><?= plan_active($me) ? h($me['plan_name']) : 'None' ?></strong><small><?= plan_active($me) ? 'until ' . h(fmt_time($me['plan_expires_at'])) : '' ?></small></div>
  <div class="stat"><span>Runs (30 days)</span><strong><?= number_format($runs30) ?></strong></div>
  <div class="stat"><span>Credits used (30 days)</span><strong><?= number_format($used30) ?></strong></div>
</div>
<div class="two-col">
  <section class="card">
    <div class="card-head"><h2>📌 Pinned tools</h2><a href="<?= h(url('tools')) ?>">All tools →</a></div>
    <?php if (!$pinned): ?>
      <p class="muted">Pin your favourite tools from the Tools List to see them here.</p>
    <?php else: ?>
      <div class="mini-list"><?php foreach ($pinned as $t): ?>
        <a href="<?= h(url('tools/' . $t['slug'])) ?>"><span><?= h($t['icon']) ?></span><?= h($t['name']) ?></a>
      <?php endforeach; ?></div>
    <?php endif; ?>
  </section>
  <section class="card">
    <div class="card-head"><h2>🕘 Recent activity</h2><a href="<?= h(url('history')) ?>">History →</a></div>
    <?php if (!$recent): ?>
      <p class="muted">No tool runs yet.</p>
    <?php else: ?>
      <div class="mini-list"><?php foreach ($recent as $r): ?>
        <a href="<?= h(url('history/' . $r['id'])) ?>"><span><?= h($r['icon']) ?></span><?= h($r['name']) ?><em><?= h(fmt_time($r['created_at'])) ?></em></a>
      <?php endforeach; ?></div>
    <?php endif; ?>
  </section>
</div>
