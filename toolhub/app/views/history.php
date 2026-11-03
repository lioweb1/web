<h1 class="page-title">Usage History</h1>
<div class="card table-wrap"><table class="table">
  <thead><tr><th>Tool</th><th class="num">Credits</th><th>Status</th><th>Date</th></tr></thead>
  <tbody>
  <?php if (!$items): ?><tr><td colspan="4" class="muted">No tool runs yet.</td></tr><?php endif; ?>
  <?php foreach ($items as $i): ?>
    <tr>
      <td><a href="<?= h(url('history/' . $i['id'])) ?>"><?= h($i['icon']) ?> <?= h($i['name']) ?></a></td>
      <td class="num"><?= $i['status'] === 'failed' ? '0 (refunded)' : (int) $i['credits'] ?></td>
      <td><?= h($i['status']) ?></td>
      <td><?= h(fmt_time($i['created_at'])) ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table></div>
<h2 class="section-title">Credit transactions</h2>
<div class="card table-wrap"><table class="table">
  <thead><tr><th>Date</th><th>Description</th><th class="num">Change</th><th class="num">Balance</th></tr></thead>
  <tbody><?php foreach ($ledger as $l): ?>
    <tr><td><?= h(fmt_time($l['created_at'])) ?></td><td><?= h($l['reason']) ?></td><td class="num <?= $l['delta'] < 0 ? 'neg' : 'pos' ?>"><?= $l['delta'] > 0 ? '+' : '' ?><?= (int) $l['delta'] ?></td><td class="num"><?= (int) $l['balance_after'] ?></td></tr>
  <?php endforeach; ?></tbody>
</table></div>
