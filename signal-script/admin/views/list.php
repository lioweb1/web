<?php /** @var array $ent */ global $a; ?>
<div class="toolbar">
  <form class="filters" method="get">
    <input type="hidden" name="a" value="<?= e($a) ?>">
    <?php if (!empty($ent['search'])): ?><input type="text" name="s" value="<?= e($search) ?>" placeholder="Search…"><?php endif; ?>
    <?php foreach ($ent['filters'] ?? [] as $col => $opts): ?>
      <select name="<?= e($col) ?>" onchange="this.form.submit()">
        <option value=""><?= e(ucfirst($col)) ?>: all</option>
        <?php foreach ($opts as $k => $l): ?><option value="<?= e($k) ?>" <?= ($_GET[$col] ?? '') === (string)$k ? 'selected' : '' ?>><?= e($l) ?></option><?php endforeach; ?>
      </select>
    <?php endforeach; ?>
    <?php if (!empty($ent['search'])): ?><button class="btn btn-sm">Filter</button><?php endif; ?>
  </form>
  <a class="btn btn-primary" href="<?= e(admin_url($a, ['do' => 'new'])) ?>">+ New <?= e($ent['singular']) ?></a>
</div>
<p class="muted"><?= (int)$total ?> item(s)</p>
<?php if (!$rows): ?>
  <div class="empty">Nothing here yet. <a href="<?= e(admin_url($a, ['do' => 'new'])) ?>">Create the first <?= e($ent['singular']) ?></a>.</div>
<?php else: ?>
<div class="table-wrap"><table class="table">
  <thead><tr>
    <?php foreach ($ent['columns'] as $col => $def): ?><th><?= e(is_string($def) ? $def : ucfirst(str_replace('_', ' ', $col))) ?></th><?php endforeach; ?>
    <th class="right">Actions</th>
  </tr></thead>
  <tbody>
  <?php foreach ($rows as $r): ?>
    <tr>
      <?php foreach ($ent['columns'] as $col => $def): ?>
        <td><?= $def instanceof Closure ? $def($r) : e($r[$col] ?? "") ?></td>
      <?php endforeach; ?>
      <td class="right actions">
        <?php foreach ($ent['actions'] ?? [] as $key => $act): if (($act['show'])($r)): ?>
          <form method="post" action="<?= e(admin_url($a, ['do' => 'action', 'id' => $r['id']])) ?>"><?= csrf_field() ?><input type="hidden" name="act" value="<?= e($key) ?>"><button class="btn btn-xs <?= $key === 'win' ? 'btn-success' : ($key === 'loss' ? 'btn-danger' : '') ?>"><?= e($act['label']) ?></button></form>
        <?php endif; endforeach; ?>
        <?php if (isset($ent['view'])): ?><a class="btn btn-xs" href="<?= e(($ent['view'])($r)) ?>" target="_blank">View</a><?php endif; ?>
        <a class="btn btn-xs" href="<?= e(admin_url($a, ['do' => 'edit', 'id' => $r['id']])) ?>">Edit</a>
        <form method="post" action="<?= e(admin_url($a, ['do' => 'delete', 'id' => $r['id']])) ?>" onsubmit="return confirm('Delete this item permanently?')"><?= csrf_field() ?><button class="btn btn-xs btn-ghost-danger">Delete</button></form>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table></div>
<?= $pager ?>
<?php endif; ?>
