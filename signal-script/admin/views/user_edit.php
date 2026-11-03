<p><a href="<?= e(admin_url('users')) ?>">← Users</a></p>
<div class="grid-2">
<form method="post" class="card form">
  <?= csrf_field() ?>
  <input type="hidden" name="do" value="save">
  <input type="hidden" name="id" value="<?= (int)($u['id'] ?? 0) ?>">
  <label>Name <input name="name" value="<?= e($u['name'] ?? '') ?>"></label>
  <label>Email <input type="email" name="email" required value="<?= e($u['email'] ?? '') ?>"></label>
  <label>Role <select name="role"><option value="user">User</option><option value="admin" <?= ($u['role'] ?? '') === 'admin' ? 'selected' : '' ?>>Admin</option></select></label>
  <label>Status <select name="status"><option value="active">Active</option><option value="banned" <?= ($u['status'] ?? '') === 'banned' ? 'selected' : '' ?>>Banned</option></select></label>
  <label>Premium until (UTC) <input type="datetime-local" name="premium_until" value="<?= !empty($u['premium_until']) ? e(str_replace(' ', 'T', substr($u['premium_until'], 0, 16))) : '' ?>"></label>
  <label><?= $u ? 'New password (leave empty to keep)' : 'Password' ?> <input type="password" name="password" autocomplete="new-password" <?= $u ? '' : 'required minlength="8"' ?>></label>
  <div class="form-actions"><button class="btn btn-primary">Save user</button></div>
</form>
<?php if ($u): ?>
<div>
  <div class="card">
    <h3>Info</h3>
    <p>Referral code: <code><?= e($u['ref_code']) ?></code><br>
    Referred by: <?= $refBy ? '<a href="' . e(admin_url('users', ['edit' => $refBy['id']])) . '">' . e($refBy['email']) . '</a>' : '—' ?><br>
    Referral days earned: <?= (int)$u['referral_days_earned'] ?><br>
    Marketing opt-in: <?= (int)$u['marketing_optin'] ? 'Yes' : 'No' ?><br>
    Last login: <?= e(fmt_time($u['last_login'])) ?></p>
    <form method="post" class="row"><?= csrf_field() ?><input type="hidden" name="do" value="add_days"><input type="hidden" name="id" value="<?= (int)$u['id'] ?>"><input type="number" name="days" value="30" style="width:90px"><button class="btn btn-sm">Add premium days</button></form>
  </div>
  <div class="card">
    <h3>Payments</h3>
    <?php if (!$payments): ?><p class="muted">None.</p><?php else: ?>
    <table class="table compact"><tbody><?php foreach ($payments as $p): ?><tr><td><?= e(fmt_time($p['created_at'], 'M j, Y')) ?></td><td><?= e($p['plan_name']) ?></td><td><?= e($p['currency'] . ' ' . $p['amount']) ?></td><td><span class="badge b-<?= e($p['status']) ?>"><?= e($p['status']) ?></span></td></tr><?php endforeach; ?></tbody></table>
    <?php endif; ?>
  </div>
  <?php if ((int)$u['id'] !== (int)current_user()['id']): ?>
  <form method="post" onsubmit="return confirm('Delete this user and their payments?')"><?= csrf_field() ?><input type="hidden" name="do" value="delete"><input type="hidden" name="id" value="<?= (int)$u['id'] ?>"><button class="btn btn-ghost-danger">Delete user</button></form>
  <?php endif; ?>
</div>
<?php endif; ?>
</div>
