<?php if ($pg['custom_css']): ?><style><?= $pg['custom_css'] ?></style><?php endif; ?>
<section class="section">
  <div class="container narrow">
    <h1><?= e($pg['title']) ?></h1>
    <div class="content"><?= $pg['content'] ?></div>
  </div>
</section>
