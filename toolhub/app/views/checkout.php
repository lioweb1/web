<a class="back" href="<?= h(url('plans')) ?>">← Plans</a>
<h1 class="page-title">Checkout: <?= h($package['name']) ?></h1>
<p class="muted"><?= number_format((int) $package['credits']) ?> credits<?= (int) $package['days'] > 0 ? ' · ' . (int) $package['days'] . ' days' : '' ?> · <strong><?= money($package['price_usd']) ?> USD</strong></p>
<?php if ($error): ?><div class="alert alert-error"><?= h($error) ?></div><?php endif; ?>
<?php if (!$methods): ?>
  <div class="alert alert-error">No payment methods are available right now. Please contact support.</div>
<?php else: ?>
<form method="post" class="card form">
  <?= csrf_field() ?>
  <div class="method-grid">
    <?php foreach ($methods as $i => $m): ?>
      <label class="method">
        <input type="radio" name="method" value="<?= h($m['code']) ?>" <?= $i === 0 ? 'checked' : '' ?> required>
        <span class="method-body">
          <strong><?= h($m['name']) ?></strong>
          <span class="price-sm"><?= money(order_amount($package)) ?></span>
          <span class="muted small"><?= $m['kind'] === 'manual' ? 'Manual — verified by our team' : 'Instant — automatic' ?></span>
        </span>
      </label>
    <?php endforeach; ?>
  </div>
  <button class="btn btn-primary btn-lg btn-block" type="submit">Continue to payment</button>
  <p class="muted small center">🔒 Card and wallet details are entered on the payment provider's secure page, never on this site.</p>
</form>
<?php endif; ?>
