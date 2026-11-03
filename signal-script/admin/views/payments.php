<div class="toolbar">
  <div class="tabs">
    <?php foreach (['' => 'All', 'pending' => 'Pending', 'approved' => 'Approved', 'rejected' => 'Rejected'] as $k => $l): ?>
      <a class="<?= $status === $k ? 'active' : '' ?>" href="<?= e(admin_url('payments', ['status' => $k])) ?>"><?= $l ?></a>
    <?php endforeach; ?>
  </div>
</div>
<?php if (!$rows): ?><div class="empty">No payments.</div><?php else: ?>
<div class="table-wrap"><table class="table">
  <thead><tr><th>#</th><th>Date</th><th>User</th><th>Plan</th><th>Amount</th><th>Method</th><th>Transaction ID</th><th>Note</th><th>Status</th><th class="right">Actions</th></tr></thead>
  <tbody>
  <?php foreach ($rows as $p): ?>
    <tr>
      <td><?= (int)$p['id'] ?></td>
      <td class="nowrap"><?= e(fmt_time($p['created_at'])) ?></td>
      <td><a href="<?= e(admin_url('users', ['edit' => $p['user_id']])) ?>"><?= e($p['email'] ?? 'deleted') ?></a></td>
      <td><?= e($p['plan_name']) ?></td>
      <td><?= e($p['currency'] . ' ' . $p['amount']) ?><?php if (!empty($p['coupon_code'])): ?><br><small class="muted">🏷 <?= e($p['coupon_code']) ?> (was <?= e($p['original_amount']) ?>)</small><?php endif; ?></td>
      <td><?= e($p['method']) ?><?php if (($p['gateway'] ?? 'manual') !== 'manual'): ?> <span class="badge b-info">auto</span><?php endif; ?></td>
      <td><code><?= e($p['txn_id']) ?></code></td>
      <td class="muted"><?= e($p['note']) ?></td>
      <td><span class="badge b-<?= e($p['status']) ?>"><?= e($p['status']) ?></span></td>
      <td class="right actions">
        <?php if ($p['status'] !== 'approved'): ?>
          <form method="post"><?= csrf_field() ?><input type="hidden" name="id" value="<?= (int)$p['id'] ?>"><input type="hidden" name="do" value="approve"><button class="btn btn-xs btn-success">Approve</button></form>
        <?php endif; ?>
        <?php if ($p['status'] === 'pending'): ?>
          <form method="post"><?= csrf_field() ?><input type="hidden" name="id" value="<?= (int)$p['id'] ?>"><input type="hidden" name="do" value="reject"><button class="btn btn-xs btn-danger">Reject</button></form>
        <?php endif; ?>
        <form method="post" onsubmit="return confirm('Delete payment record?')"><?= csrf_field() ?><input type="hidden" name="id" value="<?= (int)$p['id'] ?>"><input type="hidden" name="do" value="delete"><button class="btn btn-xs btn-ghost-danger">Delete</button></form>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table></div>
<?php endif; ?>
