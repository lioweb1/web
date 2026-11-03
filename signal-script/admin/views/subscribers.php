<div class="toolbar">
  <form class="filters" method="get">
    <input type="hidden" name="a" value="subscribers">
    <input type="text" name="s" value="<?= e($s) ?>" placeholder="Search…">
    <button class="btn btn-sm">Search</button>
  </form>
  <div class="row">
    <a class="btn btn-primary" href="<?= e(admin_url('subscribers', ['export' => 'subscribed'])) ?>">⬇ Export subscribed (CSV)</a>
    <a class="btn" href="<?= e(admin_url('subscribers', ['export' => 'all'])) ?>">⬇ Export all</a>
  </div>
</div>
<p class="muted"><?= (int)$active ?> subscribed · <?= (int)$total ?> total. Export the CSV to Mailchimp, Brevo, MailerLite, Moosend etc. to send newsletters. The CSV includes each person's unsubscribe link.</p>
<div class="grid-2">
  <form method="post" class="card form row"><?= csrf_field() ?><input type="hidden" name="do" value="add"><input type="email" name="email" placeholder="email@example.com" required><input type="text" name="name" placeholder="Name"><button class="btn">Add</button></form>
  <form method="post" enctype="multipart/form-data" class="card form row"><?= csrf_field() ?><input type="hidden" name="do" value="import"><input type="file" name="csv" accept=".csv,text/csv" required><button class="btn">Import CSV</button><small class="help">Columns: email, name</small></form>
</div>
<?php if (!$rows): ?><div class="empty">No subscribers yet. Opt-in forms are on the homepage, footer and popup.</div><?php else: ?>
<div class="table-wrap"><table class="table">
  <thead><tr><th>Email</th><th>Name</th><th>Source</th><th>Status</th><th>Date</th><th>IP</th><th class="right">Actions</th></tr></thead>
  <tbody>
  <?php foreach ($rows as $r): ?>
    <tr>
      <td><?= e($r['email']) ?></td><td><?= e($r['name']) ?></td><td><?= e($r['source']) ?></td>
      <td><span class="badge b-<?= $r['status'] === 'subscribed' ? 'active' : 'loss' ?>"><?= e($r['status']) ?></span></td>
      <td class="nowrap"><?= e(fmt_time($r['created_at'])) ?></td><td class="muted"><?= e($r['ip']) ?></td>
      <td class="right actions">
        <form method="post"><?= csrf_field() ?><input type="hidden" name="do" value="toggle"><input type="hidden" name="id" value="<?= (int)$r['id'] ?>"><button class="btn btn-xs"><?= $r['status'] === 'subscribed' ? 'Unsubscribe' : 'Resubscribe' ?></button></form>
        <form method="post" onsubmit="return confirm('Delete?')"><?= csrf_field() ?><input type="hidden" name="do" value="delete"><input type="hidden" name="id" value="<?= (int)$r['id'] ?>"><button class="btn btn-xs btn-ghost-danger">Delete</button></form>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table></div>
<?= $pager ?>
<?php endif; ?>
