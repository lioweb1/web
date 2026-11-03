<section class="section">
  <div class="container auth-box">
    <h1><?= e($title) ?></h1>
    <form method="post" class="card form">
      <?= csrf_field() ?>
      <?php if ($mode === 'register'): ?>
        <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off">
        <label>Name <input name="name" required maxlength="120" value="<?= e(old('name')) ?>"></label>
        <label>Email <input type="email" name="email" required maxlength="190" value="<?= e(old('email')) ?>"></label>
        <label>Password <input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
        <label class="check"><input type="checkbox" name="optin" value="1" checked> <span><?= e(setting('optin_consent')) ?></span></label>
        <button class="btn btn-primary btn-block">Create free account</button>
        <p class="muted center">Have an account? <a class="link" href="<?= e(url('login')) ?>">Log in</a></p>
      <?php elseif ($mode === 'login'): ?>
        <input type="hidden" name="next" value="<?= e((string)($_GET['next'] ?? '')) ?>">
        <label>Email <input type="email" name="email" required value="<?= e(old('email')) ?>" autocomplete="email"></label>
        <label>Password <input type="password" name="password" required autocomplete="current-password"></label>
        <button class="btn btn-primary btn-block">Log in</button>
        <p class="muted center"><a class="link" href="<?= e(url('forgot')) ?>">Forgot password?</a> · <a class="link" href="<?= e(url('register')) ?>">Create account</a></p>
      <?php elseif ($mode === 'forgot'): ?>
        <label>Email <input type="email" name="email" required></label>
        <button class="btn btn-primary btn-block">Send reset link</button>
      <?php else: ?>
        <label>New password <input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
        <button class="btn btn-primary btn-block">Save password</button>
      <?php endif; ?>
    </form>
  </div>
</section>
