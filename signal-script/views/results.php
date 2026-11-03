<section class="section">
  <div class="container">
    <div class="section-head">
      <div><h1>Results & Performance</h1><p class="muted">Every closed signal, tracked automatically against real market prices.</p></div>
      <div class="tabs">
        <?php foreach (['' => 'All', 'binary' => 'Binary', 'forex' => 'Forex', 'crypto' => 'Crypto'] as $k => $l): ?>
          <a class="<?= $market === $k ? 'active' : '' ?>" href="<?= e(url('results') . ($k ? '?market=' . $k : '')) ?>"><?= $l ?></a>
        <?php endforeach; ?>
      </div>
    </div>
    <div class="stats-row">
      <?php $st = $stats7; $label = 'Last 7 days'; include __DIR__ . '/partials/stats.php'; ?>
      <?php $st = $stats30; $label = 'Last 30 days'; include __DIR__ . '/partials/stats.php'; ?>
      <?php $st = $statsAll; $label = 'All time'; include __DIR__ . '/partials/stats.php'; ?>
    </div>
    <?php if (!$rows): ?>
      <div class="empty big">No closed signals yet.</div>
    <?php else: ?>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>#</th><th>Date</th><th>Asset</th><th>Market</th><th>Signal</th><th>Entry</th><th>Close</th><th>Conf.</th><th>Result</th></tr></thead>
      <tbody>
      <?php foreach ($rows as $r): ?>
        <tr>
          <td><a class="link" href="<?= e(url('signal/' . $r['id'])) ?>">#<?= (int)$r['id'] ?></a></td>
          <td><?= e(fmt_time($r['created_at'])) ?></td>
          <td><strong><?= e($r['asset']) ?></strong> <?= (int)$r['is_premium'] ? '⭐' : '' ?></td>
          <td><?= e($r['market']) ?></td>
          <td class="<?= $r['direction'] === 'BUY' ? 'up' : 'down' ?>"><?= e(signal_label($r)) ?></td>
          <td><?= fmt_price($r['entry']) ?></td>
          <td><?= fmt_price($r['close_price']) ?></td>
          <td><?= (int)$r['confidence'] ?>%</td>
          <td><span class="result <?= e($r['status']) ?>"><?= e(strtoupper($r['status'])) ?></span></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table></div>
    <?= $pager ?>
    <?php endif; ?>
    <p class="muted small mt"><?= e(setting('disclaimer')) ?></p>
  </div>
</section>
