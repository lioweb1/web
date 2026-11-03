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
    <div class="stats-row">
      <div class="stat"><div class="stat-num"><?= (int)$streak['current'] ?></div><div class="stat-label">Current win streak</div><div class="stat-sub">consecutive wins</div></div>
      <div class="stat"><div class="stat-num"><?= (int)$streak['best'] ?></div><div class="stat-label">Best win streak</div><div class="stat-sub">last 200 signals</div></div>
      <div class="stat"><div class="stat-num"><?= (int)$statsAll['total'] ?></div><div class="stat-label">Signals tracked</div><div class="stat-sub">all time</div></div>
    </div>
    <div class="card"><h3>Last 30 days</h3><?php include __DIR__ . '/partials/perf_chart.php'; ?></div>
    <?php if ($perAsset): ?>
      <h2 class="mt">Accuracy by asset</h2>
      <div class="asset-grid">
        <?php foreach ($perAsset as $pa): $t = (int)$pa['w'] + (int)$pa['l']; $rate = $t ? round($pa['w'] / $t * 100) : 0; ?>
          <div class="asset-stat"><div class="as-top"><strong><?= e($pa['asset']) ?></strong><span class="tag tag-<?= e($pa['market']) ?>"><?= e($pa['market']) ?></span></div>
            <div class="as-rate <?= $rate >= 50 ? 'up' : 'down' ?>"><?= $rate ?>%</div>
            <div class="conf-bar"><span style="width:<?= $rate ?>%"></span></div>
            <small class="muted"><?= (int)$pa['w'] ?> W / <?= (int)$pa['l'] ?> L</small></div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
    <h2 class="mt">Signal history</h2>
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
