<?php $cronUrl = url('cron.php?key=' . setting('cron_key')); $last = setting('last_cron'); ?>
<div class="kpis">
  <div class="kpi"><span>Users</span><b><?= $c['users'] ?></b><small>+<?= $c['new_users'] ?> in 30 days</small></div>
  <div class="kpi"><span>Premium members</span><b class="gold"><?= $c['premium'] ?></b></div>
  <div class="kpi"><span>Email subscribers</span><b><?= $c['subscribers'] ?></b></div>
  <div class="kpi"><span>Revenue (30 days)</span><b><?= number_format($c['revenue'], 2) ?></b></div>
  <div class="kpi"><span>Pending payments</span><b class="<?= $c['pending'] ? 'warn' : '' ?>"><?= $c['pending'] ?></b></div>
  <div class="kpi"><span>Active signals</span><b><?= $c['active'] ?></b><small><?= $c['today'] ?> today</small></div>
  <div class="kpi"><span>Win rate (30 days)</span><b class="up"><?= $stats['rate'] ?>%</b><small><?= $stats['wins'] ?>W / <?= $stats['losses'] ?>L</small></div>
  <div class="kpi"><span>Affiliate clicks (30 days)</span><b><?= $c['clicks'] ?></b></div>
</div>

<div class="grid-2">
  <div class="card">
    <h3>Signal engine</h3>
    <p>Status: <?= setting('auto_enabled') === '1' ? '<span class="badge b-active">Auto ON</span>' : '<span class="badge">Auto OFF</span>' ?>
       · Last run: <strong><?= $last ? e(time_ago($last)) : 'never' ?></strong></p>
    <?php if (!$last || strtotime($last . ' UTC') < time() - 900): ?>
      <div class="alert alert-error">The cron job hasn't run recently. Set it up in hPanel → Advanced → Cron Jobs (every 1–5 minutes).</div>
    <?php endif; ?>
    <?php if (setting('twelvedata_key') === ''): ?><div class="alert alert-info">Add a free Twelve Data API key in <a href="<?= e(admin_url('settings', ['tab' => 'engine'])) ?>">Settings → Signal engine</a> to enable forex pairs. Crypto pairs work without a key.</div><?php endif; ?>
    <p class="muted small">Cron command (Hostinger):</p>
    <pre class="pre">php <?= e(APP_ROOT) ?>/cron.php</pre>
    <p class="muted small">Or call this URL every minute (cron-job.org etc.):</p>
    <pre class="pre"><?= e($cronUrl) ?></pre>
    <div class="row">
      <form method="post"><?= csrf_field() ?><input type="hidden" name="do" value="run_engine"><button class="btn btn-primary">▶ Run engine now</button></form>
      <form method="post"><?= csrf_field() ?><input type="hidden" name="do" value="test_telegram"><button class="btn">Test Telegram</button></form>
      <a class="btn" href="<?= e(admin_url('signals', ['do' => 'new'])) ?>">+ Manual signal</a>
    </div>
  </div>
  <div class="card">
    <h3>Pending payments</h3>
    <?php if (!$pendingPayments): ?><p class="muted">No pending payments.</p><?php else: ?>
      <table class="table compact"><tbody>
      <?php foreach ($pendingPayments as $p): ?>
        <tr><td><?= e($p['email']) ?></td><td><?= e($p['plan_name']) ?></td><td><?= e($p['currency'] . ' ' . $p['amount']) ?></td><td><code><?= e($p['txn_id']) ?></code></td></tr>
      <?php endforeach; ?>
      </tbody></table>
      <a class="btn btn-sm" href="<?= e(admin_url('payments', ['status' => 'pending'])) ?>">Review payments →</a>
    <?php endif; ?>
    <h3 class="mt">Top brokers (30 days clicks)</h3>
    <?php if (!$topBrokers): ?><p class="muted">Add brokers to start earning affiliate commissions.</p><?php else: ?>
      <table class="table compact"><tbody><?php foreach ($topBrokers as $b): ?><tr><td><?= e($b['name']) ?></td><td class="right"><?= (int)$b['n'] ?></td></tr><?php endforeach; ?></tbody></table>
    <?php endif; ?>
  </div>
</div>

<div class="card">
  <h3>Recent engine activity <a class="small" href="<?= e(admin_url('log')) ?>">full log →</a></h3>
  <?php if (!$log): ?><p class="muted">No activity yet. Click “Run engine now”.</p><?php else: ?>
    <table class="table compact"><tbody><?php foreach ($log as $l): ?><tr><td class="muted nowrap"><?= e(fmt_time($l['created_at'], 'M j H:i:s')) ?></td><td><span class="badge b-<?= e($l['level']) ?>"><?= e($l['level']) ?></span></td><td><?= e($l['message']) ?></td></tr><?php endforeach; ?></tbody></table>
  <?php endif; ?>
</div>
