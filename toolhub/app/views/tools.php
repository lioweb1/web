<div class="filter-bar">
  <div class="pills" role="tablist">
    <button class="pill active" type="button" data-cat="all">All</button>
    <?php foreach ($categories as $c): ?><button class="pill" type="button" data-cat="<?= h($c) ?>"><?= h($c) ?></button><?php endforeach; ?>
  </div>
  <input class="search" type="search" placeholder="Search for a tool…" data-tool-search aria-label="Search tools">
</div>
<div class="info-banner">📌 <div><strong>Stay organized with pinned tools</strong><br>Click the pin on any tool to keep your favourites at the top.</div></div>
<div class="tool-grid">
  <?php foreach ($tools as $t): ?>
    <div class="tool-card" data-category="<?= h($t['category']) ?>" data-name="<?= h(mb_strtolower($t['name'] . ' ' . $t['description'])) ?>">
      <?php if ($t['is_new']): ?><span class="ribbon">New</span><?php endif; ?>
      <form method="post" action="<?= h(url('tools/' . $t['slug'] . '/pin')) ?>" class="pin-form"><?= csrf_field() ?>
        <button class="pin <?= $t['pinned'] ? 'pinned' : '' ?>" type="submit" title="<?= $t['pinned'] ? 'Unpin' : 'Pin' ?>">📌</button>
      </form>
      <div class="tool-icon"><?= h($t['icon']) ?></div>
      <h3><?= h($t['name']) ?></h3>
      <span class="badge"><?= h($t['category']) ?></span>
      <p class="muted small"><?= h($t['description']) ?></p>
      <div class="cost"><?= (int) $t['credit_cost'] ?> credit<?= (int) $t['credit_cost'] === 1 ? '' : 's' ?> / run</div>
      <a class="btn btn-success btn-block" href="<?= h(url('tools/' . $t['slug'])) ?>">Access Now</a>
    </div>
  <?php endforeach; ?>
</div>
<p class="muted center" data-no-results hidden>No tools match your search.</p>
