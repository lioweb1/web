<section class="section">
  <div class="container">
    <div class="section-head center"><h1>Premium Plans</h1><p class="muted">Free members get standard signals. Premium unlocks everything.</p></div>
    <div class="compare card">
      <table class="table">
        <thead><tr><th>Feature</th><th>Free</th><th>Premium</th></tr></thead>
        <tbody>
          <tr><td>Standard auto signals</td><td>✔</td><td>✔</td></tr>
          <tr><td>High-confidence premium signals</td><td>—</td><td>✔</td></tr>
          <tr><td>Instant access (no delay)</td><td><?= (int)setting('free_delay_minutes') > 0 ? '—' : '✔' ?></td><td>✔</td></tr>
          <tr><td>Premium Telegram channel</td><td>—</td><td>✔</td></tr>
          <tr><td>Premium analysis articles</td><td>—</td><td>✔</td></tr>
          <tr><td>Results history</td><td>✔</td><td>✔</td></tr>
        </tbody>
      </table>
    </div>
    <?php if (!$plans): ?><div class="empty big">Plans coming soon.</div><?php else: ?>
      <div class="plan-grid"><?php foreach ($plans as $p) include __DIR__ . '/partials/plan_card.php'; ?></div>
    <?php endif; ?>
    <div class="trust-row">
      <span>🔒 Secure payments</span><span>⚡ Instant access<?= nowpayments_enabled() ? ' with crypto' : ' after verification' ?></span><span>📊 Transparent results</span><span>💬 Support on Telegram</span>
    </div>
  </div>
</section>
<?php include __DIR__ . '/partials/testimonials.php'; ?>
<?php include __DIR__ . '/partials/faq.php'; ?>
<section class="section"><div class="container"><p class="muted small center"><?= e(setting('disclaimer')) ?></p></div></section>
