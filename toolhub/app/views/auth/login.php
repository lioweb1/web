<div class="card narrow">
  <h1>Log in</h1>
  <?php if ($error): ?><div class="alert alert-error"><?= h($error) ?></div><?php endif; ?>
  <form method="post" class="form">
    <?= csrf_field() ?>
    <label>Email<input type="email" name="email" value="<?= h($email) ?>" required autofocus autocomplete="email"></label>
    <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn btn-primary btn-block" type="submit">Log in</button>
  </form>
  <p class="muted small"><a href="<?= h(url('forgot-password')) ?>">Forgot password?</a> · No account? <a href="<?= h(url('register')) ?>">Sign up</a></p>
</div>
