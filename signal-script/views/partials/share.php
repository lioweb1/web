<div class="share">
  <span class="muted small">Share:</span>
  <?php foreach (share_links($shareUrl, $shareText) as $name => $href): ?>
    <a href="<?= e($href) ?>" target="_blank" rel="noopener" class="share-btn"><?= e($name) ?></a>
  <?php endforeach; ?>
  <button type="button" class="share-btn" data-copy-text="<?= e($shareUrl) ?>">Copy link</button>
</div>
