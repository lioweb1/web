<?php /** @var array $b */ ?>
<div class="broker-card <?= (int)$b['featured'] ? 'featured' : '' ?>">
  <?php if ((int)$b['featured']): ?><span class="ribbon">Top pick</span><?php endif; ?>
  <div class="bk-logo"><?php if ($b['logo_url']): ?><img src="<?= e($b['logo_url']) ?>" alt="<?= e($b['name']) ?>" loading="lazy"><?php else: ?><span><?= e(mb_substr($b['name'], 0, 1)) ?></span><?php endif; ?></div>
  <div class="bk-body">
    <h3><?= e($b['name']) ?></h3>
    <div class="stars" title="<?= e($b['rating']) ?>/5"><?= str_repeat('★', (int)round((float)$b['rating'])) . str_repeat('☆', 5 - (int)round((float)$b['rating'])) ?> <small><?= e($b['rating']) ?></small></div>
    <?php if ($b['bonus_text']): ?><div class="bonus">🎁 <?= e($b['bonus_text']) ?></div><?php endif; ?>
    <?php if ($b['description']): ?><p class="muted"><?= e($b['description']) ?></p><?php endif; ?>
    <div class="bk-meta">
      <?php if ($b['markets']): ?><span><?= e($b['markets']) ?></span><?php endif; ?>
      <?php if ($b['min_deposit']): ?><span>Min. deposit: <?= e($b['min_deposit']) ?></span><?php endif; ?>
    </div>
  </div>
  <a class="btn btn-primary" href="<?= e(url('go/' . $b['id'])) ?>" target="_blank" rel="sponsored noopener">Open account</a>
</div>
