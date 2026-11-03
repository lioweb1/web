<section class="section">
  <div class="container">
    <div class="section-head"><div><h1>Recommended Brokers</h1><p class="muted">Brokers we use to trade our signals. Some links are affiliate links.</p></div></div>
    <?php if (!$brokers): ?><div class="empty big">No brokers added yet.</div><?php else: ?>
      <div class="broker-list"><?php foreach ($brokers as $b) include __DIR__ . '/partials/broker_card.php'; ?></div>
    <?php endif; ?>
    <p class="muted small mt">Disclosure: we may receive a commission when you open an account through our links. <?= e(setting('disclaimer')) ?></p>
  </div>
</section>
