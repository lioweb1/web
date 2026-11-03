<?php $rows = $result['rows']; ?>
<div class="table-wrap"><table class="table">
  <thead><tr><th>Keyword</th><th class="num">Monthly searches</th><th>Competition</th><th class="num">CPC (USD)</th></tr></thead>
  <tbody><?php foreach ($rows as $r): ?>
    <tr><td><?= h($r['keyword']) ?></td><td class="num"><?= $r['volume'] === null ? '—' : number_format((int) $r['volume']) ?></td><td><?= h($r['competition'] ?? '—') ?></td><td class="num"><?= $r['cpc'] === null ? '—' : number_format((float) $r['cpc'], 2) ?></td></tr>
  <?php endforeach; ?></tbody>
</table></div>
