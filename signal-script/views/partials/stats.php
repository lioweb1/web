<?php /** @var array $st */ ?>
<div class="stat"><div class="stat-num"><?= e($st['rate']) ?>%</div><div class="stat-label"><?= e($label ?? 'Win rate') ?></div><div class="stat-sub"><?= (int)$st['wins'] ?> W / <?= (int)$st['losses'] ?> L</div></div>
