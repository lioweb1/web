<?php $on = chat_enabled(); ?>
<?php if (!$on): ?>
  <div class="alert alert-info">The AI chat is <strong>off</strong>. Get a free API key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a>, paste it in <a href="<?= e(admin_url('settings', ['tab' => 'ai'])) ?>">Settings → AI chat</a> and tick “Enable AI chat assistant”.</div>
<?php endif; ?>
<div class="kpis">
  <div class="kpi"><span>Status</span><b class="<?= $on ? 'up' : 'muted' ?>"><?= $on ? 'Online' : 'Off' ?></b><small><?= e(setting('gemini_model')) ?></small></div>
  <div class="kpi"><span>Messages (24h)</span><b><?= $stats['today'] ?></b></div>
  <div class="kpi"><span>Visitors chatting (24h)</span><b><?= $stats['users'] ?></b></div>
  <div class="kpi"><span>Errors (24h)</span><b class="<?= $stats['errors'] ? 'warn' : '' ?>"><?= $stats['errors'] ?></b></div>
</div>
<div class="grid-2">
  <div class="card">
    <h3>Messages per day</h3>
    <?php $max = max(1, ...array_values($series)); ?>
    <div class="mini-bars"><?php foreach ($series as $d => $v): ?><span style="height:<?= max(2, round($v / $max * 100)) ?>%" title="<?= e($d) ?>: <?= (int)$v ?>" class="<?= $v ? 'on' : '' ?>"></span><?php endforeach; ?></div>
  </div>
  <div class="card">
    <h3>Tools</h3>
    <div class="row">
      <form method="post"><?= csrf_field() ?><input type="hidden" name="do" value="test"><button class="btn btn-primary">Test Gemini connection</button></form>
      <a class="btn" href="<?= e(admin_url('settings', ['tab' => 'ai'])) ?>">AI settings</a>
      <form method="post" onsubmit="return confirm('Delete all chat logs?')"><?= csrf_field() ?><input type="hidden" name="do" value="clear"><button class="btn btn-ghost-danger">Clear log</button></form>
    </div>
    <p class="muted small mt">Limits per 24h: guests <?= (int)setting('chat_limit_guest') ?>, free members <?= (int)setting('chat_limit_user') ?>, premium <?= (int)setting('chat_limit_premium') ?>. Read questions here to find out what visitors want, then add answers to the knowledge base.</p>
  </div>
</div>
<?php if (!$rows): ?><div class="empty">No conversations yet.</div><?php else: ?>
<div class="table-wrap"><table class="table">
  <thead><tr><th>Time</th><th>Visitor</th><th>Question</th><th>Answer</th></tr></thead>
  <tbody><?php foreach ($rows as $r): ?>
    <tr>
      <td class="nowrap muted"><?= e(fmt_time($r['created_at'], 'M j H:i')) ?></td>
      <td class="nowrap"><?= $r['user_id'] ? '<a href="' . e(admin_url('users', ['edit' => $r['user_id']])) . '">' . e($r['email'] ?? '#' . $r['user_id']) . '</a>' : '<span class="muted">guest ' . e($r['ip']) . '</span>' ?></td>
      <td style="max-width:320px"><?= e($r['question']) ?></td>
      <td style="max-width:460px" class="<?= $r['status'] === 'error' ? 'down' : 'muted' ?>"><?= $r['answer'] !== null ? nl2br(e(mb_substr((string)$r['answer'], 0, 600))) : '—' ?></td>
    </tr>
  <?php endforeach; ?></tbody>
</table></div>
<?= $pager ?>
<?php endif; ?>
