<section class="section">
  <div class="container narrow">
    <h1>Upgrade to <?= e($plan['name']) ?></h1>
    <div class="card">
      <p class="price"><?= e($plan['currency']) ?> <?= e(number_format((float)$plan['price'], 2)) ?> <small>for <?= (int)$plan['duration_days'] ?> days</small></p>
      <div class="instructions"><?= nl2br(e(setting('payment_instructions'))) ?></div>
    </div>
    <form method="post" class="card form">
      <?= csrf_field() ?>
      <input type="hidden" name="plan_id" value="<?= (int)$plan['id'] ?>">
      <label>Payment method
        <select name="method" required>
          <option value="">Choose…</option>
          <?php foreach (lines(setting('payment_methods')) as $m): ?><option><?= e($m) ?></option><?php endforeach; ?>
        </select>
      </label>
      <label>Transaction ID / reference <input name="txn_id" required maxlength="190" value="<?= e(old('txn_id')) ?>"></label>
      <label>Note (optional) <textarea name="note" rows="3" maxlength="1000"><?= e(old('note')) ?></textarea></label>
      <button class="btn btn-gold btn-block">Submit payment</button>
    </form>
  </div>
</section>
