<h1 class="page-title">Users</h1>
<form class="search-row" method="get"><input type="search" name="q" value="<?= h($q) ?>" placeholder="Search name or email"><button class="btn btn-light">Search</button></form>
<div class="card table-wrap"><table class="table">
  <thead><tr><th>#</th><th>Name</th><th>Email</th><th class="num">Credits</th><th>Plan until</th><th>Status</th><th>Joined</th></tr></thead>
  <tbody><?php foreach ($users as $u): ?>
    <tr>
      <td><?= (int) $u['id'] ?></td>
      <td><a href="<?= h(url('admin/users/' . $u['id'])) ?>"><?= h($u['name']) ?></a><?= $u['role'] === 'admin' ? ' <span class="badge">admin</span>' : '' ?></td>
      <td><?= h($u['email']) ?></td>
      <td class="num"><?= number_format((int) $u['credits']) ?></td>
      <td><?= plan_active($u) ? h(fmt_time($u['plan_expires_at'])) : '<span class="muted">—</span>' ?></td>
      <td><?= h($u['status']) ?></td>
      <td class="small"><?= h(fmt_time($u['created_at'])) ?></td>
    </tr>
  <?php endforeach; ?></tbody>
</table></div>
