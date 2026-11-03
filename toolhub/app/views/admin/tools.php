<div class="card-head"><h1 class="page-title">Tools</h1><a class="btn btn-primary" href="<?= h(url('admin/tools/new')) ?>">+ New tool</a></div>
<div class="card table-wrap"><table class="table">
  <thead><tr><th>Tool</th><th>Category</th><th>Type</th><th class="num">Credits</th><th>Ready</th><th>Active</th><th></th></tr></thead>
  <tbody><?php foreach ($tools as $t): ?>
    <tr>
      <td><?= h($t['icon']) ?> <?= h($t['name']) ?><br><span class="muted small">/tools/<?= h($t['slug']) ?></span></td>
      <td><?= h($t['category']) ?></td>
      <td><?= $t['type'] === 'ai_text' ? 'AI (Claude)' : 'DataForSEO' ?></td>
      <td class="num"><?= (int) $t['credit_cost'] ?></td>
      <td><?= tool_available($t) ? '✅' : '⚠️ API key missing' ?></td>
      <td><form method="post"><?= csrf_field() ?><input type="hidden" name="action" value="toggle"><input type="hidden" name="id" value="<?= (int) $t['id'] ?>"><button class="btn btn-sm <?= $t['is_active'] ? 'btn-success' : 'btn-light' ?>"><?= $t['is_active'] ? 'On' : 'Off' ?></button></form></td>
      <td><a class="btn btn-light btn-sm" href="<?= h(url('admin/tools/' . $t['id'])) ?>">Edit</a></td>
    </tr>
  <?php endforeach; ?></tbody>
</table></div>
