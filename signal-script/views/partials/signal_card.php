<?php
/** @var array $s */
$viewer = current_user();
$open = can_view_signal($s, $viewer);
$isBuy = $s['direction'] === 'BUY';
$label = signal_label($s);
$statusClass = ['win' => 'win', 'loss' => 'loss', 'expired' => 'muted', 'cancelled' => 'muted'][$s['status']] ?? '';
?>
<article class="signal-card <?= $open ? ($isBuy ? 'is-buy' : 'is-sell') : 'is-locked' ?>" data-id="<?= (int)$s['id'] ?>">
  <div class="sc-head">
    <span class="tag tag-<?= e($s['market']) ?>"><?= e(ucfirst($s['market'])) ?></span>
    <?php if ((int)$s['is_premium']): ?><span class="tag tag-gold">⭐ Premium</span><?php endif; ?>
    <span class="sc-time" title="<?= e(fmt_time($s['created_at'])) ?>"><?= e(time_ago($s['created_at'])) ?></span>
  </div>
  <?php if ($open): ?>
    <a class="sc-main" href="<?= e(url('signal/' . $s['id'])) ?>">
      <div class="sc-asset"><?= e($s['asset']) ?> <small><?= e($s['timeframe']) ?></small></div>
      <div class="sc-dir <?= $isBuy ? 'up' : 'down' ?>"><?= $isBuy ? '▲' : '▼' ?> <?= e($label) ?></div>
    </a>
    <dl class="sc-levels">
      <div><dt>Entry</dt><dd><?= fmt_price($s['entry']) ?></dd></div>
      <?php if ($s['market'] === 'binary'): ?>
        <div><dt>Expiry</dt><dd><?= (int)$s['expiry_minutes'] ?> min</dd></div>
      <?php else: ?>
        <div><dt>SL</dt><dd class="down"><?= fmt_price($s['stop_loss']) ?></dd></div>
        <div><dt>TP</dt><dd class="up"><?= fmt_price($s['take_profit']) ?></dd></div>
      <?php endif; ?>
      <div><dt>Confidence</dt><dd><?= (int)$s['confidence'] ?>%</dd></div>
    </dl>
    <div class="conf-bar"><span style="width:<?= (int)$s['confidence'] ?>%"></span></div>
    <div class="sc-foot">
      <?php if ($s['status'] === 'active'): ?>
        <span class="countdown" data-expires="<?= e(iso_utc($s['expires_at'])) ?>">--:--</span>
      <?php else: ?>
        <span class="result <?= $statusClass ?>"><?= e(strtoupper($s['status'])) ?><?= $s['close_price'] !== null ? ' @ ' . fmt_price($s['close_price']) : '' ?></span>
      <?php endif; ?>
      <a href="<?= e(url('signal/' . $s['id'])) ?>" class="link">Chart →</a>
    </div>
  <?php else: ?>
    <div class="sc-main locked">
      <div class="sc-asset blur">XXX/XXX</div>
      <div class="sc-dir blur">▲ ????</div>
    </div>
    <div class="lock-box">
      <div>🔒 <?= (int)$s['is_premium'] ? 'Premium signal' : 'Available in a few minutes' ?> · <?= (int)$s['confidence'] ?>% confidence</div>
      <a class="btn btn-gold btn-sm" href="<?= e(url('pricing')) ?>">Unlock now</a>
    </div>
  <?php endif; ?>
</article>
