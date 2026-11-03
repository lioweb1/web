<h1 class="page-title">Payment History</h1>
<?php if (!$orders): ?>
  <div class="card"><p class="muted">No payments yet. <a href="<?= h(url('plans')) ?>">Buy a plan</a>.</p></div>
<?php else: ?>
<div class="card table-wrap"><table class="table">
  <thead><tr><th>Order</th><th>Package</th><th>Method</th><th class="num">Amount</th><th>Status</th><th>Date</th></tr></thead>
  <tbody><?php foreach ($orders as $o): ?>
    <tr>
      <td><a href="<?= h(url('orders/' . $o['id'])) ?>">#<?= (int) $o['id'] ?></a></td>
      <td><?= h($o['package_name']) ?></td>
      <td><?= h($o['method_code']) ?></td>
      <td class="num"><?= money($o['amount'], $o['currency']) ?></td>
      <td><?php $s = $o['status']; require __DIR__ . '/partials/status.php'; ?></td>
      <td><?= h(fmt_time($o['created_at'])) ?></td>
    </tr>
  <?php endforeach; ?></tbody>
</table></div>
<?php endif; ?>
