<h1 class="page-title">Plans &amp; Credits</h1>
<p class="muted">A monthly plan unlocks every tool and adds credits. Each tool run uses a few credits. Top-ups add extra credits to an active plan.</p>
<div class="plan-grid">
  <?php foreach ($packages as $p): ?>
    <div class="plan <?= $p['is_featured'] ? 'featured' : '' ?>">
      <?php if ($p['is_featured']): ?><span class="ribbon-label">Most popular</span><?php endif; ?>
      <h3><?= h($p['name']) ?></h3>
      <div class="price"><?= money($p['price_bdt'], 'BDT') ?><small><?= (int) $p['days'] > 0 ? ' / ' . (int) $p['days'] . ' days' : ' one-time' ?></small></div>
      <div class="muted"><?= money($p['price_usd'], 'USD') ?> with international methods</div>
      <ul>
        <li><?= number_format((int) $p['credits']) ?> credits</li>
        <?php if ((int) $p['days'] > 0): ?><li>All tools for <?= (int) $p['days'] ?> days</li><?php else: ?><li>Adds to your current plan</li><?php endif; ?>
        <?php if ($p['description']): ?><li><?= h($p['description']) ?></li><?php endif; ?>
      </ul>
      <a class="btn btn-primary btn-block" href="<?= h(url('checkout/' . $p['id'])) ?>">Buy now</a>
    </div>
  <?php endforeach; ?>
</div>
