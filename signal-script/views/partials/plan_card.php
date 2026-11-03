<?php /** @var array $p */ ?>
<div class="plan-card <?= (int)$p['highlight'] ? 'highlight' : '' ?>">
  <?php if ((int)$p['highlight']): ?><span class="ribbon">Most popular</span><?php endif; ?>
  <h3><?= e($p['name']) ?></h3>
  <div class="price"><?= e($p['currency'] === 'USD' ? '$' : $p['currency'] . ' ') ?><?= e(rtrim(rtrim(number_format((float)$p['price'], 2, '.', ''), '0'), '.')) ?><small> / <?= (int)$p['duration_days'] ?> days</small></div>
  <ul class="features">
    <?php foreach (lines((string)$p['features']) as $f): ?><li>✔ <?= e($f) ?></li><?php endforeach; ?>
  </ul>
  <a class="btn <?= (int)$p['highlight'] ? 'btn-gold' : 'btn-primary' ?> btn-block" href="<?= e(url('upgrade/' . $p['id'])) ?>">Choose <?= e($p['name']) ?></a>
</div>
