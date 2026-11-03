<div class="card narrow">
  <h1>Set a new password</h1>
  <?php if (!$valid): ?>
    <div class="alert alert-error">This reset link is invalid or has expired.</div>
    <a href="<?= h(url('forgot-password')) ?>">Request a new link</a>
  <?php else: ?>
    <?php if ($error): ?><div class="alert alert-error"><?= h($error) ?></div><?php endif; ?>
    <form method="post" class="form">
      <?= csrf_field() ?>
      <input type="hidden" name="token" value="<?= h($token) ?>">
      <label>New password<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn btn-primary btn-block" type="submit">Save password</button>
    </form>
  <?php endif; ?>
</div>
