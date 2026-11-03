<h1 class="page-title">Payment Methods</h1>
<p class="muted">Automatic gateways need their API keys in <code>config.php</code>. Manual methods only need your account details below — customers submit the transaction ID and you approve it in <a href="<?= h(url('admin/payments')) ?>">Payments</a>.</p>
<?php foreach ($methods as $m): ?>
  <form method="post" class="card form compact">
    <?= csrf_field() ?><input type="hidden" name="id" value="<?= (int) $m['id'] ?>">
    <div class="card-head">
      <h2><?= h($m['name']) ?> <span class="badge"><?= $m['kind'] === 'gateway' ? 'Automatic' : 'Manual' ?> · <?= h($m['currency']) ?></span></h2>
      <?php if (!$m['configured']): ?><span class="status status-amber">API keys missing in config.php</span><?php endif; ?>
    </div>
    <div class="row">
      <label>Display name<input name="name" value="<?= h($m['name']) ?>" maxlength="80"></label>
      <label>Sort<input type="number" name="sort" value="<?= (int) $m['sort'] ?>"></label>
    </div>
    <?php if ($m['kind'] === 'manual'): ?>
      <label>Your account details (number / Pay ID / wallet address)<textarea name="account_details" rows="2"><?= h($m['account_details']) ?></textarea></label>
    <?php else: ?><input type="hidden" name="account_details" value="<?= h($m['account_details']) ?>"><?php endif; ?>
    <label>Instructions for the customer<textarea name="instructions" rows="2"><?= h($m['instructions']) ?></textarea></label>
    <div class="checks">
      <label><input type="checkbox" name="is_active" <?= $m['is_active'] ? 'checked' : '' ?>> Show on checkout</label>
      <button class="btn btn-primary btn-sm" type="submit">Save</button>
    </div>
  </form>
<?php endforeach; ?>
