<h1 class="page-title">Packages</h1>
<p class="muted">Days &gt; 0 = monthly plan (extends access). Days = 0 = top-up credits only.</p>
<?php foreach (array_merge($packages, [['id' => 0, 'name' => '', 'description' => '', 'credits' => 100, 'days' => 30, 'price_usd' => '', 'is_featured' => 0, 'is_active' => 1, 'sort' => 10]]) as $p): ?>
  <form method="post" class="card form compact">
    <?= csrf_field() ?><input type="hidden" name="id" value="<?= (int) $p['id'] ?>">
    <h2><?= $p['id'] ? h($p['name']) : '+ New package' ?></h2>
    <div class="row">
      <label>Name<input name="name" value="<?= h($p['name']) ?>" required maxlength="100"></label>
      <label>Credits<input type="number" name="credits" value="<?= (int) $p['credits'] ?>" min="1" required></label>
      <label>Days<input type="number" name="days" value="<?= (int) $p['days'] ?>" min="0"></label>
      <label>Price (USD $)<input type="number" step="0.01" min="0.5" required name="price_usd" value="<?= h($p['price_usd']) ?>"></label>
      <label>Sort<input type="number" name="sort" value="<?= (int) $p['sort'] ?>"></label>
    </div>
    <label>Description<input name="description" value="<?= h($p['description']) ?>" maxlength="255"></label>
    <div class="checks">
      <label><input type="checkbox" name="is_featured" <?= $p['is_featured'] ? 'checked' : '' ?>> Featured</label>
      <label><input type="checkbox" name="is_active" <?= $p['is_active'] ? 'checked' : '' ?>> Active</label>
      <button class="btn btn-primary btn-sm" type="submit">Save</button>
    </div>
  </form>
<?php endforeach; ?>
