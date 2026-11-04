<section class="hero">
  <h1>All your AI &amp; SEO tools.<br><span class="accent">One simple monthly plan.</span></h1>
  <p class="lead"><?= count($tools) ?>+ tools for writing, SEO, social media, marketing and code — in 20+ languages. Pay in US dollars with card, PayPal, Binance, Bybit, USDT, crypto or Wise.</p>
  <a class="btn btn-primary btn-lg" href="<?= h(url('register')) ?>">Create free account</a>
</section>
<section>
  <h2 class="section-title">Tools included</h2>
  <div class="chip-cloud">
    <?php foreach ($tools as $t): ?><span class="chip"><?= h($t['icon']) ?> <?= h($t['name']) ?></span><?php endforeach; ?>
  </div>
</section>
<section>
  <h2 class="section-title">Pricing</h2>
  <div class="plan-grid">
    <?php foreach ($packages as $p): ?>
      <div class="plan <?= $p['is_featured'] ? 'featured' : '' ?>">
        <?php if ($p['is_featured']): ?><span class="ribbon-label">Most popular</span><?php endif; ?>
        <h3><?= h($p['name']) ?></h3>
        <div class="price"><?= money($p['price_usd']) ?><small> / <?= (int) $p['days'] ?> days</small></div>
        <ul><li><?= number_format((int) $p['credits']) ?> credits</li><li>All tools</li><li>Usage history</li></ul>
        <a class="btn btn-primary btn-block" href="<?= h(url('register')) ?>">Get started</a>
      </div>
    <?php endforeach; ?>
  </div>
</section>
