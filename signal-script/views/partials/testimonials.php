<?php if (!empty($testimonials)): ?>
<section class="section">
  <div class="container">
    <div class="section-head center"><h2>What our members say</h2></div>
    <div class="testi-grid">
      <?php foreach ($testimonials as $t): ?>
        <figure class="testi reveal">
          <div class="stars"><?= str_repeat('★', max(1, min(5, (int)$t['rating']))) ?></div>
          <blockquote><?= e($t['content']) ?></blockquote>
          <figcaption>
            <?php if ($t['avatar_url']): ?><img src="<?= e($t['avatar_url']) ?>" alt="" loading="lazy"><?php else: ?><span class="avatar"><?= e(mb_strtoupper(mb_substr($t['name'], 0, 1))) ?></span><?php endif; ?>
            <div><strong><?= e($t['name']) ?></strong><?php if ($t['role']): ?><small><?= e($t['role']) ?></small><?php endif; ?></div>
          </figcaption>
        </figure>
      <?php endforeach; ?>
    </div>
  </div>
</section>
<?php endif; ?>
