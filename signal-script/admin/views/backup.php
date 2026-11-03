<div class="grid-2">
  <div class="card">
    <h3>Download a full database backup</h3>
    <p class="muted">Downloads a .sql file with all users, signals, payments, subscribers, posts and settings. Restore it any time with phpMyAdmin → Import. Make a backup before big changes and at least once a week.</p>
    <form method="post"><?= csrf_field() ?><button class="btn btn-primary">💾 Download backup (.sql)</button></form>
    <p class="muted small mt">Also back up the <code>uploads/</code> folder and <code>config.php</code> from the File Manager. Hostinger also keeps automatic backups (hPanel → Files → Backups).</p>
  </div>
  <div class="card">
    <h3>Database tables</h3>
    <table class="table compact"><thead><tr><th>Table</th><th class="right">Rows (approx.)</th><th class="right">Size</th></tr></thead><tbody>
      <?php foreach ($sizes as $t): ?><tr><td><?= e($t['t']) ?></td><td class="right"><?= (int)$t['r'] ?></td><td class="right"><?= (int)$t['kb'] ?> KB</td></tr><?php endforeach; ?>
    </tbody></table>
  </div>
</div>
