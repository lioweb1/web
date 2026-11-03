<?php $prem = user_is_premium($u); $refLink = url('?ref=' . $u['ref_code']); ?>
<section class="section">
  <div class="container">
    <div class="section-head">
      <div><h1>Hi, <?= e($u['name']) ?></h1><p class="muted"><?= e($u['email']) ?></p></div>
      <form method="post" action="<?= e(url('logout')) ?>"><?= csrf_field() ?><button class="btn btn-outline btn-sm">Log out</button></form>
    </div>
    <div class="dash-grid">
      <div class="card">
        <h3>Membership</h3>
        <?php if ($prem): ?>
          <p class="big-status gold">⭐ Premium</p>
          <p class="muted"><?= $u['role'] === 'admin' ? 'Admin account' : 'Active until ' . e(fmt_time($u['premium_until'])) ?></p>
          <a class="btn btn-outline btn-sm" href="<?= e(url('pricing')) ?>">Extend</a>
        <?php else: ?>
          <p class="big-status">Free</p>
          <p class="muted">Unlock high-confidence signals and the premium Telegram channel.</p>
          <a class="btn btn-gold" href="<?= e(url('pricing')) ?>">Upgrade now</a>
        <?php endif; ?>
        <?php if ($prem && setting('telegram_premium_chat') && setting('social_telegram')): ?><p class="mt"><a class="link" href="<?= e(setting('social_telegram')) ?>" target="_blank">Join Telegram →</a></p><?php endif; ?>
      </div>
      <div class="card">
        <h3>Refer & earn</h3>
        <p class="muted">Share your link. When a friend buys premium you get <strong><?= (int)setting('referral_reward_days', '7') ?> free premium days</strong>.</p>
        <div class="copy-row"><input readonly value="<?= e($refLink) ?>" id="reflink"><button class="btn btn-sm btn-primary" data-copy="#reflink">Copy</button></div>
        <p class="muted small">Referred users: <strong><?= (int)$referrals ?></strong> · Days earned: <strong><?= (int)$u['referral_days_earned'] ?></strong></p>
      </div>
      <div class="card">
        <h3>Profile</h3>
        <form method="post" class="form">
          <?= csrf_field() ?><input type="hidden" name="action" value="profile">
          <label>Name <input name="name" value="<?= e($u['name']) ?>" maxlength="120"></label>
          <label class="check"><input type="checkbox" name="optin" value="1" <?= (int)$u['marketing_optin'] ? 'checked' : '' ?>> <span>Email me free signals and news</span></label>
          <button class="btn btn-sm btn-primary">Save</button>
        </form>
      </div>
      <div class="card">
        <h3>Change password</h3>
        <form method="post" class="form">
          <?= csrf_field() ?><input type="hidden" name="action" value="password">
          <label>Current <input type="password" name="current" required></label>
          <label>New <input type="password" name="password" required minlength="8"></label>
          <button class="btn btn-sm btn-outline">Change</button>
        </form>
      </div>
    </div>

    <?php if ($signals): ?>
      <div class="section-head mt"><h2>Active signals</h2><a class="link" href="<?= e(url('signals')) ?>">All →</a></div>
      <div class="signal-grid"><?php foreach ($signals as $s) include __DIR__ . '/partials/signal_card.php'; ?></div>
    <?php endif; ?>

    <h2 class="mt">Payments</h2>
    <?php if (!$payments): ?><div class="empty">No payments yet.</div><?php else: ?>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Method</th><th>TXN</th><th>Status</th></tr></thead>
      <tbody><?php foreach ($payments as $p): ?>
        <tr><td><?= e(fmt_time($p['created_at'])) ?></td><td><?= e($p['plan_name']) ?></td><td><?= e($p['currency'] . ' ' . $p['amount']) ?></td><td><?= e($p['method']) ?></td><td><code><?= e($p['txn_id']) ?></code></td><td><span class="result <?= $p['status'] === 'approved' ? 'win' : ($p['status'] === 'rejected' ? 'loss' : '') ?>"><?= e($p['status']) ?></span></td></tr>
      <?php endforeach; ?></tbody>
    </table></div>
    <?php endif; ?>
  </div>
</section>
