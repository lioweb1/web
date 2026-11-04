<a class="back" href="<?= h(url('orders')) ?>">← Payment history</a>
<h1 class="page-title">Order #<?= (int) $order['id'] ?> <?php $s = $order['status']; require __DIR__ . '/partials/status.php'; ?></h1>
<div class="two-col">
  <section class="card">
    <h2>Summary</h2>
    <dl class="dl">
      <dt>Package</dt><dd><?= h($order['package_name']) ?></dd>
      <dt>Credits</dt><dd><?= number_format((int) $order['credits']) ?></dd>
      <dt>Amount</dt><dd><strong><?= money($order['amount'], $order['currency']) ?></strong></dd>
      <dt>Method</dt><dd><?= h($method['name'] ?? $order['method_code']) ?></dd>
      <dt>Created</dt><dd><?= h(fmt_time($order['created_at'])) ?></dd>
      <?php if ($order['paid_at']): ?><dt>Paid</dt><dd><?= h(fmt_time($order['paid_at'])) ?></dd><?php endif; ?>
      <?php if ($order['gateway_txn']): ?><dt>Transaction</dt><dd><code><?= h($order['gateway_txn']) ?></code></dd><?php endif; ?>
      <?php if ($order['manual_txid']): ?><dt>Your TrxID</dt><dd><code><?= h($order['manual_txid']) ?></code></dd><?php endif; ?>
      <?php if ($order['admin_note']): ?><dt>Note</dt><dd><?= h($order['admin_note']) ?></dd><?php endif; ?>
    </dl>
  </section>

  <?php if ($method && $method['kind'] === 'manual' && $order['status'] === 'pending'): ?>
  <section class="card">
    <h2>How to pay</h2>
    <ol class="steps">
      <li>Send exactly <strong class="big"><?= money($order['amount']) ?></strong><?= in_array($order['method_code'], ['usdt_trc20', 'usdt_bep20', 'binance_manual', 'bybit_manual'], true) ? ' (' . h(number_format((float) $order['amount'], 2)) . ' USDT)' : ' USD' ?> to:
        <pre class="account"><?= h($method['account_details']) ?></pre></li>
      <li><?= nl2br(h($method['instructions'])) ?></li>
      <li>Use reference <code><?= h(invoice_no($order)) ?></code> if the app lets you add a note.</li>
    </ol>
    <?php if ($error): ?><div class="alert alert-error"><?= h($error) ?></div><?php endif; ?>
    <form method="post" class="form">
      <?= csrf_field() ?>
      <label>Your account / number / wallet you paid from<input name="sender" required maxlength="191"></label>
      <label>Transaction ID (TxID / hash / transfer number)<input name="txid" required minlength="6" maxlength="191"></label>
      <button class="btn btn-success btn-block" type="submit">I have paid — submit for verification</button>
    </form>
  </section>
  <?php elseif ($order['status'] === 'awaiting_review'): ?>
  <section class="card"><h2>⏳ Under review</h2><p>We're checking your payment. Credits are added as soon as it's verified.</p></section>
  <?php elseif ($order['status'] === 'paid'): ?>
  <section class="card"><h2>✅ Paid</h2><p><?= number_format((int) $order['credits']) ?> credits were added to your account.</p><a class="btn btn-success" href="<?= h(url('tools')) ?>">Open tools</a></section>
  <?php elseif (in_array($order['status'], ['failed', 'cancelled', 'rejected'], true)): ?>
  <section class="card"><h2>Payment not completed</h2><p class="muted">No money was taken for this order, or it could not be verified. You can try again.</p><a class="btn btn-primary" href="<?= h(url('checkout/' . $order['package_id'])) ?>">Try again</a></section>
  <?php else: ?>
  <section class="card"><h2>Waiting for payment</h2><p class="muted">If you already paid, the status updates automatically within a few minutes.</p></section>
  <?php endif; ?>
</div>
