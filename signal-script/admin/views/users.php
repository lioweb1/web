<div class="toolbar">
  <form class="filters" method="get">
    <input type="hidden" name="a" value="users">
    <input type="text" name="s" value="<?= e($s) ?>" placeholder="Search name or email…">
    <select name="f" onchange="this.form.submit()">
      <option value="">All users</option>
      <option value="premium" <?= $f === 'premium' ? 'selected' : '' ?>>Premium</option>
      <option value="admin" <?= $f === 'admin' ? 'selected' : '' ?>>Admins</option>
    </select>
    <button class="btn btn-sm">Filter</button>
  </form>
  <a class="btn btn-primary" href="<?= e(admin_url('users', ['edit' => 'new'])) ?>">+ New user</a>
</div>
<p class="muted"><?= (int)$total ?> user(s)</p>
<div class="table-wrap"><table class="table">
  <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>Premium until</th><th>Referrals</th><th>Opt-in</th><th>Joined</th><th class="right">Actions</th></tr></thead>
  <tbody>
  <?php foreach ($rows as $u): $prem = user_is_premium($u); ?>
    <tr>
      <td><?= (int)$u['id'] ?></td>
      <td><?= e($u['name']) ?><?= $u['status'] === 'banned' ? ' <span class="badge b-loss">banned</span>' : '' ?></td>
      <td><?= e($u['email']) ?></td>
      <td><?= e($u['role']) ?></td>
      <td><?= $u['premium_until'] ? '<span class="' . ($prem ? 'gold' : 'muted') . '">' . e(fmt_time($u['premium_until'], 'M j, Y')) . '</span>' : '—' ?></td>
      <td><?= (int)$u['refs'] ?></td>
      <td><?= (int)$u['marketing_optin'] ? '✔' : '' ?></td>
      <td class="nowrap"><?= e(fmt_time($u['created_at'], 'M j, Y')) ?></td>
      <td class="right actions">
        <form method="post"><?= csrf_field() ?><input type="hidden" name="do" value="add_days"><input type="hidden" name="id" value="<?= (int)$u['id'] ?>"><input type="hidden" name="days" value="30"><button class="btn btn-xs">+30 days</button></form>
        <a class="btn btn-xs" href="<?= e(admin_url('users', ['edit' => $u['id']])) ?>">Edit</a>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table></div>
<?= $pager ?>
