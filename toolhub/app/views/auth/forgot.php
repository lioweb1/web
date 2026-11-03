<div class="card narrow">
  <h1>Forgot password</h1>
  <?php if ($sent): ?>
    <div class="alert alert-success">If an account exists for that email, we sent a reset link. Check your inbox and spam folder.</div>
  <?php else: ?>
    <form method="post" class="form">
      <?= csrf_field() ?>
      <label>Email<input type="email" name="email" required autofocus></label>
      <button class="btn btn-primary btn-block" type="submit">Send reset link</button>
    </form>
  <?php endif; ?>
  <p class="muted small"><a href="<?= h(url('login')) ?>">Back to log in</a></p>
</div>
