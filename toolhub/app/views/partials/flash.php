<?php foreach (take_flashes() as $f): ?>
  <div class="alert alert-<?= h($f['type']) ?>"><?= h($f['message']) ?></div>
<?php endforeach; ?>
