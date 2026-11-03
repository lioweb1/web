<a class="back" href="<?= h(url('admin/users')) ?>">← Users</a>
<h1 class="page-title"><?= h($u['name']) ?> <span class="muted small"><?= h($u['email']) ?></span></h1>
<div class="stats">
  <div class="stat"><span>Credits</span><strong><?= number_format((int) $u['credits']) ?></strong></div>
  <div class="stat"><span>Plan</span><strong><?= plan_active($u) ? h($u['plan_name']) : 'None' ?></strong><small><?= plan_active($u) ? 'until ' . h(fmt_time($u['plan_expires_at'])) : '' ?></small></div>
  <div class="stat"><span>Status</span><strong><?= h($u['status']) ?></strong></div>
  <div class="stat"><span>Last login</span><strong class="small"><?= h(fmt_time($u['last_login_at'])) ?></strong></div>
</div>
<div class="three-col">
  <form method="post" class="card form"><?= csrf_field() ?><input type="hidden" name="action" value="credits">
    <h2>Adjust credits</h2>
    <label>Change (use - to remove)<input type="number" name="delta" required></label>
    <label>Reason<input name="reason" maxlength="150" placeholder="e.g. Bonus, refund"></label>
    <button class="btn btn-primary">Apply</button>
  </form>
  <form method="post" class="card form"><?= csrf_field() ?><input type="hidden" name="action" value="plan">
    <h2>Extend plan</h2>
    <label>Days (use - to shorten)<input type="number" name="days" value="30" required></label>
    <button class="btn btn-primary">Apply</button>
  </form>
  <form method="post" class="card form" data-confirm="Change this user's status?"><?= csrf_field() ?><input type="hidden" name="action" value="status">
    <h2>Account</h2>
    <p class="muted">Banned users cannot log in.</p>
    <button class="btn <?= $u['status'] === 'active' ? 'btn-danger' : 'btn-success' ?>"><?= $u['status'] === 'active' ? 'Ban user' : 'Unban user' ?></button>
  </form>
</div>
<div class="two-col">
  <section class="card table-wrap"><h2>Orders</h2><table class="table"><tbody>
    <?php foreach ($orders as $o): ?><tr><td><a href="<?= h(url('orders/' . $o['id'])) ?>">#<?= (int) $o['id'] ?></a></td><td><?= h($o['package_name']) ?></td><td class="num"><?= money($o['amount'], $o['currency']) ?></td><td><?php $s = $o['status']; require __DIR__ . '/../partials/status.php'; ?></td></tr><?php endforeach; ?>
  </tbody></table></section>
  <section class="card table-wrap"><h2>Credit ledger</h2><table class="table"><tbody>
    <?php foreach ($ledger as $l): ?><tr><td class="small"><?= h(fmt_time($l['created_at'])) ?></td><td><?= h($l['reason']) ?></td><td class="num <?= $l['delta'] < 0 ? 'neg' : 'pos' ?>"><?= $l['delta'] > 0 ? '+' : '' ?><?= (int) $l['delta'] ?></td></tr><?php endforeach; ?>
  </tbody></table></section>
</div>
