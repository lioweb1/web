<div class="card narrow">
  <h1>Create your account</h1>
  <?php foreach ($errors as $e): ?><div class="alert alert-error"><?= h($e) ?></div><?php endforeach; ?>
  <form method="post" class="form">
    <?= csrf_field() ?>
    <label>Full name<input name="name" value="<?= h($name) ?>" required maxlength="100" autocomplete="name"></label>
    <label>Email<input type="email" name="email" value="<?= h($email) ?>" required autocomplete="email"></label>
    <label>Password <span class="muted small">(min 8 characters)</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
    <button class="btn btn-primary btn-block" type="submit">Create account</button>
  </form>
  <p class="muted small">Already have an account? <a href="<?= h(url('login')) ?>">Log in</a></p>
</div>
