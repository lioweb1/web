<div class="card">
  <h3>Per broker</h3>
  <?php if (!$perBroker): ?><p class="muted">No brokers yet. <a href="<?= e(admin_url('brokers', ['do' => 'new'])) ?>">Add one</a>.</p><?php else: ?>
  <table class="table"><thead><tr><th>Broker</th><th>Last 30 days</th><th>Unique (30d)</th><th>All time</th><th>Tracking link</th></tr></thead><tbody>
  <?php foreach ($perBroker as $b): ?><tr><td><?= e($b['name']) ?></td><td><?= (int)$b['last30'] ?></td><td><?= (int)$b['uniq30'] ?></td><td><?= (int)$b['total'] ?></td><td><code><?= e(url('go/' . $b['id'])) ?></code></td></tr><?php endforeach; ?>
  </tbody></table>
  <?php endif; ?>
</div>
<div class="card">
  <h3>Latest clicks</h3>
  <?php if (!$recent): ?><p class="muted">No clicks yet.</p><?php else: ?>
  <table class="table compact"><thead><tr><th>Time</th><th>Broker</th><th>User</th><th>From page</th></tr></thead><tbody>
  <?php foreach ($recent as $c): ?><tr><td class="nowrap"><?= e(fmt_time($c['created_at'], 'M j H:i')) ?></td><td><?= e($c['name']) ?></td><td><?= $c['user_id'] ? '<a href="' . e(admin_url('users', ['edit' => $c['user_id']])) . '">#' . (int)$c['user_id'] . '</a>' : 'guest' ?></td><td class="muted"><?= e(mb_substr((string)$c['referer'], 0, 80)) ?></td></tr><?php endforeach; ?>
  </tbody></table>
  <?php endif; ?>
</div>
