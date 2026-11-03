<?php $me = current_user(); ?>
<h1 class="page-title">Account Settings</h1>
<?php foreach ($errors as $e): ?><div class="alert alert-error"><?= h($e) ?></div><?php endforeach; ?>
<div class="two-col">
  <form method="post" class="card form">
    <?= csrf_field() ?><input type="hidden" name="action" value="profile">
    <h2>Profile</h2>
    <label>Name<input name="name" value="<?= h($me['name']) ?>" required maxlength="100"></label>
    <label>Email<input value="<?= h($me['email']) ?>" disabled></label>
    <button class="btn btn-primary" type="submit">Save</button>
  </form>
  <form method="post" class="card form">
    <?= csrf_field() ?><input type="hidden" name="action" value="password">
    <h2>Change password</h2>
    <label>Current password<input type="password" name="current" required autocomplete="current-password"></label>
    <label>New password<input type="password" name="new" required minlength="8" autocomplete="new-password"></label>
    <button class="btn btn-primary" type="submit">Change password</button>
  </form>
</div>
