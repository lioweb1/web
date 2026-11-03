<article class="section">
  <div class="container narrow">
    <a class="link" href="<?= e(url('blog')) ?>">← Blog</a>
    <?php if ($post['category']): ?><span class="tag"><?= e($post['category']) ?></span><?php endif; ?>
    <h1 class="post-title"><?= e($post['title']) ?></h1>
    <p class="muted"><?= e(fmt_time($post['created_at'], 'F j, Y')) ?> · <?= (int)$post['views'] ?> views</p>
    <?php if ($post['image_url']): ?><img class="post-hero" src="<?= e($post['image_url']) ?>" alt="<?= e($post['title']) ?>"><?php endif; ?>
    <?php if ($locked): ?>
      <?php if ($post['excerpt']): ?><div class="content"><p><?= e($post['excerpt']) ?></p></div><?php endif; ?>
      <div class="lock-big"><p>🔒 This analysis is for premium members.</p><a class="btn btn-gold btn-lg" href="<?= e(url('pricing')) ?>">Unlock premium</a></div>
    <?php else: ?>
      <div class="content"><?= $post['content'] ?></div>
    <?php endif; ?>
    <?php $shareUrl = url('blog/' . $post['slug']); $shareText = $post['title']; include __DIR__ . '/partials/share.php'; ?>
    <?php if (setting('ad_post')): ?><div class="ad-slot"><?= setting('ad_post') ?></div><?php endif; ?>
    <?php if ($related): ?>
      <h3 class="mt">More analysis</h3>
      <div class="post-grid"><?php foreach ($related as $p) { $p += ['excerpt' => '', 'content' => '', 'category' => '']; include __DIR__ . '/partials/post_card.php'; } ?></div>
    <?php endif; ?>
  </div>
</article>
