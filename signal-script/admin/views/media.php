<form method="post" enctype="multipart/form-data" class="card form row">
  <?= csrf_field() ?>
  <input type="file" name="file" accept="image/*" required>
  <button class="btn btn-primary">Upload</button>
  <small class="help">JPG, PNG, GIF, WEBP, ICO · max 5 MB. Copy the URL into posts, pages, broker logos or settings.</small>
</form>
<?php if (!$files): ?><div class="empty">No files yet.</div><?php else: ?>
<div class="media-grid">
  <?php foreach ($files as $f): ?>
    <div class="media-item">
      <img src="<?= e($f['url']) ?>" alt="" loading="lazy">
      <input readonly value="<?= e($f['url']) ?>" onclick="this.select()">
      <form method="post" onsubmit="return confirm('Delete file?')"><?= csrf_field() ?><input type="hidden" name="do" value="delete"><input type="hidden" name="file" value="<?= e($f['name']) ?>"><button class="btn btn-xs btn-ghost-danger">Delete</button></form>
    </div>
  <?php endforeach; ?>
</div>
<?php endif; ?>
