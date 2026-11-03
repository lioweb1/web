<h1 class="page-title">Payments</h1>
<div class="pills">
  <?php foreach ($statuses as $s): ?><a class="pill <?= $s === $status ? 'active' : '' ?>" href="<?= h(url('admin/payments', ['status' => $s])) ?>"><?= h(str_replace('_', ' ', ucfirst($s))) ?></a><?php endforeach; ?>
</div>
<p class="muted small">⚠️ Before approving a manual payment, open your bKash/Nagad/Binance/Bybit/Wise app and confirm that the TrxID exists and the <strong>exact amount</strong> was received.</p>
<div class="card table-wrap"><table class="table">
  <thead><tr><th>#</th><th>User</th><th>Package</th><th>Method</th><th class="num">Amount</th><th>Sender / TrxID</th><th>Status</th><th>Date</th><th></th></tr></thead>
  <tbody>
  <?php if (!$orders): ?><tr><td colspan="9" class="muted">Nothing here.</td></tr><?php endif; ?>
  <?php foreach ($orders as $o): ?>
    <tr>
      <td><a href="<?= h(url('orders/' . $o['id'])) ?>"><?= (int) $o['id'] ?></a></td>
      <td><a href="<?= h(url('admin/users/' . $o['user_id'])) ?>"><?= h($o['user_name']) ?></a><br><span class="muted small"><?= h($o['email']) ?></span></td>
      <td><?= h($o['package_name']) ?></td>
      <td><?= h($o['method_code']) ?></td>
      <td class="num"><strong><?= money($o['amount'], $o['currency']) ?></strong></td>
      <td class="small"><?= h($o['manual_sender'] ?? '') ?><br><code><?= h($o['manual_txid'] ?? $o['gateway_txn'] ?? '') ?></code></td>
      <td><?php $s = $o['status']; require __DIR__ . '/../partials/status.php'; ?></td>
      <td class="small"><?= h(fmt_time($o['created_at'])) ?></td>
      <td>
        <?php if ($o['status'] !== 'paid' && $o['status'] !== 'rejected'): ?>
        <form method="post" class="inline-actions" data-confirm="Are you sure?">
          <?= csrf_field() ?><input type="hidden" name="order_id" value="<?= (int) $o['id'] ?>">
          <input name="note" placeholder="Note (optional)" maxlength="255">
          <button class="btn btn-success btn-sm" name="action" value="approve">Approve</button>
          <button class="btn btn-danger btn-sm" name="action" value="reject">Reject</button>
        </form>
        <?php endif; ?>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table></div>
