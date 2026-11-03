<section class="section">
  <div class="container">
    <div class="section-head">
      <div><h1>Live Signals</h1><p class="muted">Updated automatically. Times shown in <?= e(setting('display_timezone', 'UTC')) ?>.</p></div>
      <div class="tabs">
        <?php foreach (['' => 'All', 'binary' => 'Binary', 'forex' => 'Forex', 'crypto' => 'Crypto'] as $k => $l): ?>
          <a class="<?= $market === $k ? 'active' : '' ?>" href="<?= e(url('signals') . ($k ? '?market=' . $k : '')) ?>"><?= $l ?></a>
        <?php endforeach; ?>
      </div>
    </div>
    <?php if (!user_is_premium()): ?>
      <div class="upsell">⭐ Premium members see every high-confidence signal instantly. <a class="btn btn-gold btn-sm" href="<?= e(url('pricing')) ?>">Upgrade</a></div>
    <?php endif; ?>
    <?php if (setting('ad_signals')): ?><div class="ad-slot"><?= setting('ad_signals') ?></div><?php endif; ?>
    <div id="live-signals" data-max-id="<?= (int)$maxId ?>">
      <?php if (!$signals): ?>
        <div class="empty big">No active signals right now. The engine checks the market every few minutes. This page refreshes automatically.</div>
      <?php else: ?>
        <div class="signal-grid"><?php foreach ($signals as $s) include __DIR__ . '/partials/signal_card.php'; ?></div>
      <?php endif; ?>
    </div>
    <?php if ($brokers): ?>
      <h2 class="mt">Where to trade these signals</h2>
      <div class="broker-list"><?php foreach ($brokers as $b) include __DIR__ . '/partials/broker_card.php'; ?></div>
    <?php endif; ?>
  </div>
</section>
<div class="toast" id="toast" hidden></div>
