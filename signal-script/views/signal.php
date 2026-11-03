<?php /** @var array $s */ $isBuy = $s['direction'] === 'BUY'; ?>
<section class="section">
  <div class="container">
    <a class="link" href="<?= e(url('signals')) ?>">← All signals</a>
    <div class="signal-detail">
      <div class="sd-main">
        <div class="sd-head">
          <span class="tag tag-<?= e($s['market']) ?>"><?= e(ucfirst($s['market'])) ?></span>
          <?php if ((int)$s['is_premium']): ?><span class="tag tag-gold">⭐ Premium</span><?php endif; ?>
          <span class="tag"><?= e($s['source'] === 'auto' ? 'Auto engine' : 'Analyst') ?></span>
        </div>
        <?php if ($canView): ?>
          <h1><?= e($s['asset']) ?> <span class="<?= $isBuy ? 'up' : 'down' ?>"><?= $isBuy ? '▲' : '▼' ?> <?= e(signal_label($s)) ?></span></h1>
          <div class="chart-box">
            <div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>
            <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async><?= json_encode([
                'autosize' => true, 'symbol' => tv_symbol($s['asset']), 'interval' => ['1min' => '1', '5min' => '5', '15min' => '15', '30min' => '30', '1h' => '60', '4h' => '240', '1day' => 'D'][$s['timeframe']] ?? '15',
                'timezone' => 'Etc/UTC', 'theme' => 'dark', 'style' => '1', 'locale' => 'en', 'allow_symbol_change' => true, 'hide_side_toolbar' => false,
                'studies' => ['STD;RSI', 'STD;MACD'], 'support_host' => 'https://www.tradingview.com',
            ], JSON_UNESCAPED_SLASHES) ?></script></div>
          </div>
          <?php if ($s['analysis']): ?><div class="card"><h3>Analysis</h3><p><?= nl2br(e($s['analysis'])) ?></p></div><?php endif; ?>
          <?php $shareUrl = url('signal/' . $s['id']); $shareText = $s['asset'] . ' ' . signal_label($s) . ' signal'; include __DIR__ . '/partials/share.php'; ?>
        <?php else: ?>
          <h1>🔒 Premium signal</h1>
          <div class="lock-big">
            <p>This is a <strong><?= (int)$s['confidence'] ?>% confidence</strong> <?= e($s['market']) ?> signal reserved for premium members.</p>
            <a class="btn btn-gold btn-lg" href="<?= e(url('pricing')) ?>">Unlock premium signals</a>
            <?php if (!current_user()): ?><p class="muted">Already premium? <a class="link" href="<?= e(url('login')) ?>">Log in</a></p><?php endif; ?>
          </div>
        <?php endif; ?>
      </div>
      <aside class="sd-side">
        <div class="card">
          <?php if ($canView): ?>
          <dl class="kv">
            <div><dt>Direction</dt><dd class="<?= $isBuy ? 'up' : 'down' ?>"><?= e(signal_label($s)) ?></dd></div>
            <div><dt>Entry</dt><dd><?= fmt_price($s['entry']) ?></dd></div>
            <?php if ($s['market'] === 'binary'): ?>
              <div><dt>Expiry</dt><dd><?= (int)$s['expiry_minutes'] ?> minutes</dd></div>
            <?php else: ?>
              <div><dt>Stop loss</dt><dd class="down"><?= fmt_price($s['stop_loss']) ?></dd></div>
              <div><dt>Take profit 1</dt><dd class="up"><?= fmt_price($s['take_profit']) ?></dd></div>
              <div><dt>Take profit 2</dt><dd class="up"><?= fmt_price($s['take_profit2']) ?></dd></div>
            <?php endif; ?>
          <?php else: ?><dl class="kv"><?php endif; ?>
            <div><dt>Timeframe</dt><dd><?= e($s['timeframe']) ?></dd></div>
            <div><dt>Confidence</dt><dd><?= (int)$s['confidence'] ?>%</dd></div>
            <div><dt>Opened</dt><dd><?= e(fmt_time($s['created_at'])) ?></dd></div>
            <div><dt>Status</dt><dd>
              <?php if ($s['status'] === 'active'): ?><span class="countdown" data-expires="<?= e(iso_utc($s['expires_at'])) ?>">--:--</span>
              <?php else: ?><span class="result <?= e($s['status']) ?>"><?= e(strtoupper($s['status'])) ?></span><?php endif; ?>
            </dd></div>
            <?php if ($s['close_price'] !== null): ?><div><dt>Close</dt><dd><?= fmt_price($s['close_price']) ?></dd></div><?php endif; ?>
          </dl>
        </div>
        <?php if ($canView): ?>
          <div class="card">
            <h3>📒 My trade journal</h3>
            <?php if (!current_user()): ?>
              <p class="muted small">Log in to save this trade and track your personal profit &amp; loss.</p>
              <a class="btn btn-outline btn-sm" href="<?= e(url('login')) ?>">Log in</a>
            <?php else: ?>
              <form method="post" action="<?= e(url('journal')) ?>" class="form journal-form">
                <?= csrf_field() ?>
                <input type="hidden" name="signal_id" value="<?= (int)$s['id'] ?>">
                <input type="hidden" name="back" value="<?= e(parse_url(url('signal/' . $s['id']), PHP_URL_PATH)) ?>">
                <div class="two"><label>Amount ($)<input type="number" step="any" name="stake" value="<?= e($journal['stake'] ?? '10') ?>"></label>
                <label><?= $s['market'] === 'binary' ? 'Payout %' : 'Reward %' ?><input type="number" name="payout" value="<?= e($journal['payout_pct'] ?? ($s['market'] === 'binary' ? setting('journal_payout', '85') : '100')) ?>"></label></div>
                <button class="btn btn-primary btn-block btn-sm"><?= $journal ? '✔ Update journal' : '+ I took this trade' ?></button>
              </form>
              <?php if ($journal): ?><form method="post" action="<?= e(url('journal')) ?>"><?= csrf_field() ?><input type="hidden" name="do" value="remove"><input type="hidden" name="signal_id" value="<?= (int)$s['id'] ?>"><input type="hidden" name="back" value="<?= e(parse_url(url('signal/' . $s['id']), PHP_URL_PATH)) ?>"><button class="btn-link small">Remove from journal</button></form><?php endif; ?>
            <?php endif; ?>
          </div>
        <?php endif; ?>
        <?php foreach ($brokers as $b): ?>
          <a class="side-broker" href="<?= e(url('go/' . $b['id'])) ?>" target="_blank" rel="sponsored noopener">
            <strong>Trade on <?= e($b['name']) ?></strong><?php if ($b['bonus_text']): ?><span><?= e($b['bonus_text']) ?></span><?php endif; ?>
          </a>
        <?php endforeach; ?>
        <p class="muted small"><?= e(setting('disclaimer')) ?></p>
      </aside>
    </div>
  </div>
</section>
