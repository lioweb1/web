<section class="section"><div class="container auth-box">
  <?php if (!$sub): ?>
    <h1>Link not valid</h1><p class="muted">This unsubscribe link is invalid.</p>
  <?php elseif ($sub['status'] === 'unsubscribed'): ?>
    <h1>You're unsubscribed</h1><p class="muted"><?= e($sub['email']) ?> will no longer receive our emails.</p>
  <?php else: ?>
    <h1>Unsubscribe</h1>
    <form method="post" class="card form"><?= csrf_field() ?><p>Stop sending emails to <strong><?= e($sub['email']) ?></strong>?</p><button class="btn btn-outline btn-block">Unsubscribe</button></form>
  <?php endif; ?>
</div></section>
