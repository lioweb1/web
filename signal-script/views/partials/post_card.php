<?php /** @var array $p */ ?>
<a class="post-card" href="<?= e(url('blog/' . $p['slug'])) ?>">
  <div class="pc-img"<?= $p['image_url'] ? ' style="background-image:url(\'' . e($p['image_url']) . '\')"' : '' ?>><?php if ((int)($p['is_premium'] ?? 0)): ?><span class="tag tag-gold">⭐ Premium</span><?php endif; ?></div>
  <div class="pc-body">
    <?php if (!empty($p['category'])): ?><span class="tag"><?= e($p['category']) ?></span><?php endif; ?>
    <h3><?= e($p['title']) ?></h3>
    <p class="muted"><?= e(excerpt((string)($p['excerpt'] ?: ((int)($p['is_premium'] ?? 0) ? '' : $p['content'])), 120)) ?></p>
    <span class="muted small"><?= e(fmt_time($p['created_at'], 'M j, Y')) ?></span>
  </div>
</a>
