<?php
/** @var array $series list of ['date','wins','losses'] */
$n = count($series);
$max = max(1, ...array_map(fn($d) => $d['wins'] + $d['losses'], $series));
$W = 720; $H = 200; $pad = 24; $bw = ($W - $pad * 2) / max(1, $n);
$cw = 0; $cl = 0; $pts = [];
foreach ($series as $i => $d) {
    $cw += $d['wins']; $cl += $d['losses'];
    if ($cw + $cl > 0) {
        $pts[] = round($pad + $i * $bw + $bw / 2, 1) . ',' . round($H - $pad - ($cw / ($cw + $cl)) * ($H - $pad * 2), 1);
    }
}
$hasData = ($cw + $cl) > 0;
?>
<div class="perf-chart">
  <?php if (!$hasData): ?>
    <div class="empty">The performance chart appears after the first signals close.</div>
  <?php else: ?>
  <svg viewBox="0 0 <?= $W ?> <?= $H ?>" preserveAspectRatio="none" role="img" aria-label="Daily wins and losses with cumulative win rate">
    <?php foreach ([0.25, 0.5, 0.75] as $g): $y = $H - $pad - $g * ($H - $pad * 2); ?>
      <line x1="<?= $pad ?>" x2="<?= $W - $pad ?>" y1="<?= $y ?>" y2="<?= $y ?>" class="grid"/>
    <?php endforeach; ?>
    <?php foreach ($series as $i => $d):
        $x = $pad + $i * $bw + $bw * 0.2; $w = $bw * 0.6;
        $hw = $d['wins'] / $max * ($H - $pad * 2) * 0.9; $hl = $d['losses'] / $max * ($H - $pad * 2) * 0.9;
        $yb = $H - $pad; ?>
      <g><title><?= e($d['date']) ?>: <?= $d['wins'] ?> wins, <?= $d['losses'] ?> losses</title>
        <rect x="<?= round($x, 1) ?>" y="<?= round($yb - $hw, 1) ?>" width="<?= round($w, 1) ?>" height="<?= round($hw, 1) ?>" class="bar-w" rx="2"/>
        <rect x="<?= round($x, 1) ?>" y="<?= round($yb - $hw - $hl, 1) ?>" width="<?= round($w, 1) ?>" height="<?= round($hl, 1) ?>" class="bar-l" rx="2"/>
      </g>
    <?php endforeach; ?>
    <polyline points="<?= implode(' ', $pts) ?>" class="line"/>
  </svg>
  <div class="chart-legend"><span class="lg-w">Wins</span><span class="lg-l">Losses</span><span class="lg-line">Cumulative win rate</span></div>
  <?php endif; ?>
</div>
