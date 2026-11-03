<form class="optin-form" method="post" action="<?= e(url('subscribe')) ?>" data-ajax>
  <?= csrf_field() ?>
  <input type="hidden" name="source" value="<?= e($optinSource ?? 'form') ?>">
  <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off">
  <input type="text" name="name" placeholder="Your name" maxlength="120">
  <input type="email" name="email" placeholder="Your email" required maxlength="190">
  <label class="check"><input type="checkbox" name="consent" value="1" required> <span><?= e(setting('optin_consent')) ?></span></label>
  <button class="btn btn-primary btn-block" type="submit">Subscribe free</button>
  <div class="form-msg" aria-live="polite"></div>
</form>
