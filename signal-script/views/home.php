<section class="hero">
  <div class="container hero-grid">
    <div>
      <span class="pill">● Live · Auto signal engine running 24/7</span>
      <h1><?= e(setting('hero_title')) ?></h1>
      <p class="lead"><?= e(setting('hero_subtitle')) ?></p>
      <div class="hero-cta">
        <a class="btn btn-primary btn-lg" href="<?= e(url(current_user() ? 'signals' : 'register')) ?>"><?= e(setting('hero_cta')) ?></a>
        <a class="btn btn-outline btn-lg" href="<?= e(url('pricing')) ?>">⭐ Go Premium</a>
      </div>
      <div class="hero-stats">
        <?php $st = $stats; $label = '30-day win rate'; include __DIR__ . '/partials/stats.php'; ?>
        <?php $st = $statsBinary; $label = 'Binary'; include __DIR__ . '/partials/stats.php'; ?>
        <?php $st = $statsForex; $label = 'Forex'; include __DIR__ . '/partials/stats.php'; ?>
      </div>
    </div>
    <div class="hero-panel">
      <div class="panel-title">Latest signals <a href="<?= e(url('signals')) ?>" class="link">View all →</a></div>
      <?php if (!$active): ?>
        <div class="empty">The engine is scanning the market. New signals appear here automatically.</div>
      <?php else: ?>
        <div class="mini-list">
          <?php foreach (array_slice($active, 0, 4) as $s): $open = can_view_signal($s, current_user()); ?>
            <a class="mini-row" href="<?= e(url('signal/' . $s['id'])) ?>">
              <span class="tag tag-<?= e($s['market']) ?>"><?= e($s['market']) ?></span>
              <strong><?= $open ? e($s['asset']) : '🔒 Premium' ?></strong>
              <span class="<?= $open ? ($s['direction'] === 'BUY' ? 'up' : 'down') : 'muted' ?>"><?= $open ? e(signal_label($s)) : '—' ?></span>
              <span class="countdown" data-expires="<?= e(iso_utc($s['expires_at'])) ?>">--:--</span>
            </a>
          <?php endforeach; ?>
        </div>
      <?php endif; ?>
    </div>
  </div>
</section>

<?php if (setting('show_how_it_works') === '1'): ?>
<section class="section">
  <div class="container">
    <div class="section-head center"><h2>How it works</h2><p class="muted">From sign-up to your first trade in under 2 minutes.</p></div>
    <div class="steps">
      <div class="step reveal"><span class="step-n">1</span><h3>Create a free account</h3><p class="muted">Sign up in seconds and get instant access to free signals.</p></div>
      <div class="step reveal"><span class="step-n">2</span><h3>Get live signals</h3><p class="muted">Signals appear on the website, in your browser notifications and on Telegram.</p></div>
      <div class="step reveal"><span class="step-n">3</span><h3>Trade &amp; track</h3><p class="muted">Open the trade with your broker and track your results in your personal journal.</p></div>
    </div>
  </div>
</section>
<?php endif; ?>

<section class="section">
  <div class="container">
    <div class="features-grid">
      <div class="feature"><div class="f-icon">⚡</div><h3>Auto signals</h3><p class="muted">Real market data analysed with EMA, RSI, MACD and ATR. New signals every few minutes.</p></div>
      <div class="feature"><div class="f-icon">🎯</div><h3>Binary & Forex</h3><p class="muted">CALL/PUT with expiry for binary options, BUY/SELL with SL &amp; TP levels for forex and crypto.</p></div>
      <div class="feature"><div class="f-icon">📊</div><h3>Transparent results</h3><p class="muted">Every signal is tracked automatically. Wins and losses are published, nothing hidden.</p></div>
      <div class="feature"><div class="f-icon">📲</div><h3>Telegram alerts</h3><p class="muted">Get signals instantly on Telegram, on desktop and on mobile.</p></div>
    </div>
  </div>
</section>

<?php if ($active): ?>
<section class="section">
  <div class="container">
    <div class="section-head"><h2>Active signals</h2><a class="link" href="<?= e(url('signals')) ?>">All signals →</a></div>
    <div class="signal-grid">
      <?php foreach ($active as $s) include __DIR__ . '/partials/signal_card.php'; ?>
    </div>
  </div>
</section>
<?php endif; ?>

<?php if (setting('home_html')): ?><section class="section"><div class="container content"><?= setting('home_html') ?></div></section><?php endif; ?>

<?php if ($recent): ?>
<section class="section">
  <div class="container">
    <div class="section-head"><h2>Last 14 days performance</h2><a class="link" href="<?= e(url('results')) ?>">Full statistics →</a></div>
    <div class="card"><?php include __DIR__ . '/partials/perf_chart.php'; ?></div>
    <div class="section-head mt"><h2>Recent results</h2><a class="link" href="<?= e(url('results')) ?>">Full history →</a></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Asset</th><th>Market</th><th>Signal</th><th>Entry</th><th>Close</th><th>Result</th></tr></thead>
      <tbody>
      <?php foreach ($recent as $r): ?>
        <tr><td><strong><?= e($r['asset']) ?></strong></td><td><?= e($r['market']) ?></td><td class="<?= $r['direction'] === 'BUY' ? 'up' : 'down' ?>"><?= e(signal_label($r)) ?></td><td><?= fmt_price($r['entry']) ?></td><td><?= fmt_price($r['close_price']) ?></td><td><span class="result <?= e($r['status']) ?>"><?= e(strtoupper($r['status'])) ?></span></td></tr>
      <?php endforeach; ?>
      </tbody>
    </table></div>
  </div>
</section>
<?php endif; ?>

<?php if ($plans): ?>
<section class="section section-alt">
  <div class="container">
    <div class="section-head center"><h2>Unlock premium signals</h2><p class="muted">Highest-confidence signals, priority Telegram channel and premium analysis.</p></div>
    <div class="plan-grid"><?php foreach ($plans as $p) include __DIR__ . '/partials/plan_card.php'; ?></div>
  </div>
</section>
<?php endif; ?>

<?php if ($brokers): ?>
<section class="section">
  <div class="container">
    <div class="section-head"><h2>Trade our signals with a trusted broker</h2><a class="link" href="<?= e(url('brokers')) ?>">All brokers →</a></div>
    <div class="broker-list"><?php foreach ($brokers as $b) include __DIR__ . '/partials/broker_card.php'; ?></div>
  </div>
</section>
<?php endif; ?>

<?php include __DIR__ . '/partials/testimonials.php'; ?>

<section class="section">
  <div class="container">
    <div class="tools-promo">
      <a class="promo-tile reveal" href="<?= e(url('markets')) ?>"><span>🌍</span><div><h3>Markets &amp; economic calendar</h3><p class="muted">Heatmap, technical gauges and high-impact news.</p></div></a>
      <a class="promo-tile reveal" href="<?= e(url('tools')) ?>"><span>🧮</span><div><h3>Trading calculators</h3><p class="muted">Lot size, risk:reward, binary profit, compounding.</p></div></a>
    </div>
  </div>
</section>

<?php if ($posts): ?>
<section class="section">
  <div class="container">
    <div class="section-head"><h2>Latest analysis</h2><a class="link" href="<?= e(url('blog')) ?>">Blog →</a></div>
    <div class="post-grid"><?php foreach ($posts as $p) include __DIR__ . '/partials/post_card.php'; ?></div>
  </div>
</section>
<?php endif; ?>

<?php include __DIR__ . '/partials/faq.php'; ?>

<?php if (setting('optin_enabled') === '1' && !current_user()): ?>
<section class="section">
  <div class="container"><div class="cta-box">
    <div><h2><?= e(setting('optin_title')) ?></h2><p class="muted"><?= e(setting('optin_text')) ?></p></div>
    <?php $optinSource = 'home'; include __DIR__ . '/partials/optin.php'; ?>
  </div></div>
</section>
<?php endif; ?>
