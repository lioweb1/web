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
    <p class="muted small mt center"><?= e(setting('disclaimer')) ?></p>
  </div>
</section>
