<form method="post" class="mb" onsubmit="return confirm('Clear log?')"><?= csrf_field() ?><button class="btn btn-sm">Clear log</button></form>
<?php if (!$rows): ?><div class="empty">Log is empty.</div><?php else: ?>
<div class="table-wrap"><table class="table compact"><tbody>
<?php foreach ($rows as $l): ?><tr><td class="muted nowrap"><?= e(fmt_time($l['created_at'], 'M j H:i:s')) ?></td><td><span class="badge b-<?= e($l['level']) ?>"><?= e($l['level']) ?></span></td><td><?= e($l['message']) ?></td></tr><?php endforeach; ?>
</tbody></table></div>
<?php endif; ?>
