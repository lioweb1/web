<?php $saving = (float)$plan['price'] - $price; ?>
<section class="section">
  <div class="container checkout">
    <div>
      <a class="link" href="<?= e(url('pricing')) ?>">← All plans</a>
      <h1 class="mt-s">Upgrade to <?= e($plan['name']) ?></h1>
      <div class="card order">
        <div class="order-row"><span><?= e($plan['name']) ?> plan · <?= (int)$plan['duration_days'] ?> days</span><span><?= e(money($plan['price'], $plan['currency'])) ?></span></div>
        <?php if ($coupon): ?><div class="order-row up"><span>Coupon <?= e($coupon['code']) ?> (−<?= (int)$coupon['percent_off'] ?>%)</span><span>−<?= e(money($saving, $plan['currency'])) ?></span></div><?php endif; ?>
        <div class="order-row total"><span>Total</span><span><?= e(money($price, $plan['currency'])) ?></span></div>
        <form method="get" class="coupon-row">
          <input type="text" name="coupon" value="<?= e($code) ?>" placeholder="Coupon code" maxlength="40">
          <button class="btn btn-outline btn-sm">Apply</button>
        </form>
        <?php if ($couponError): ?><p class="down small"><?= e($couponError) ?></p><?php elseif ($coupon): ?><p class="up small">✔ Coupon applied, you save <?= e(money($saving, $plan['currency'])) ?>.</p><?php endif; ?>
        <ul class="features"><?php foreach (lines((string)$plan['features']) as $f): ?><li>✔ <?= e($f) ?></li><?php endforeach; ?></ul>
      </div>
    </div>
    <div>
      <?php if (nowpayments_enabled()): ?>
        <form method="post" class="card pay-card">
          <?= csrf_field() ?>
          <input type="hidden" name="plan_id" value="<?= (int)$plan['id'] ?>">
          <input type="hidden" name="coupon" value="<?= e($coupon['code'] ?? '') ?>">
          <input type="hidden" name="action" value="crypto">
          <h3>⚡ Instant activation, pay with crypto</h3>
          <p class="muted">USDT, BTC, ETH, LTC, TRX, BNB and 100+ coins. Premium activates automatically as soon as your payment is confirmed.</p>
          <button class="btn btn-gold btn-block btn-lg">Pay <?= e(money($price, $plan['currency'])) ?> with crypto</button>
        </form>
        <div class="or"><span>or pay manually</span></div>
      <?php endif; ?>
      <form method="post" class="card form">
        <?= csrf_field() ?>
        <input type="hidden" name="plan_id" value="<?= (int)$plan['id'] ?>">
        <input type="hidden" name="coupon" value="<?= e($coupon['code'] ?? '') ?>">
        <input type="hidden" name="action" value="manual">
        <h3>Manual payment</h3>
        <div class="instructions"><?= nl2br(e(setting('payment_instructions'))) ?></div>
        <p class="small muted">Send exactly <strong><?= e(money($price, $plan['currency'])) ?></strong>, then submit the transaction ID.</p>
        <label>Payment method
          <select name="method" required>
            <option value="">Choose…</option>
            <?php foreach (lines(setting('payment_methods')) as $m): ?><option><?= e($m) ?></option><?php endforeach; ?>
          </select>
        </label>
        <label>Transaction ID / reference <input name="txn_id" required maxlength="190" value="<?= e(old('txn_id')) ?>"></label>
        <label>Note (optional) <textarea name="note" rows="2" maxlength="1000"><?= e(old('note')) ?></textarea></label>
        <button class="btn btn-primary btn-block">Submit payment</button>
      </form>
      <p class="muted small center">🔒 Secure checkout · Premium is added on top of any remaining time</p>
    </div>
  </div>
</section>
