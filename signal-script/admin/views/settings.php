<div class="tabs mb">
  <?php foreach ($groups as $k => $g): ?><a class="<?= $tab === $k ? 'active' : '' ?>" href="<?= e(admin_url('settings', ['tab' => $k])) ?>"><?= e($g['title']) ?></a><?php endforeach; ?>
</div>
<form method="post" class="card form">
  <?= csrf_field() ?>
  <div class="form-grid">
  <?php foreach ($groups[$tab]['fields'] as $key => $f):
      [$label, $type] = $f; $help = $f[2] ?? ''; $val = $values[$key] ?? '';
      $wide = in_array($type, ['textarea', 'code', 'image'], true) ? ' wide' : ''; ?>
    <div class="field<?= $wide ?>">
      <?php if ($type === 'checkbox'): ?>
        <label class="check"><input type="checkbox" name="<?= e($key) ?>" value="1" <?= $val === '1' ? 'checked' : '' ?>> <?= e($label) ?></label>
      <?php else: ?>
        <label for="s-<?= e($key) ?>"><?= e($label) ?></label>
        <?php if ($type === 'textarea'): ?>
          <textarea id="s-<?= e($key) ?>" name="<?= e($key) ?>" rows="4"><?= e($val) ?></textarea>
        <?php elseif ($type === 'code'): ?>
          <textarea id="s-<?= e($key) ?>" name="<?= e($key) ?>" rows="7" class="code" spellcheck="false"><?= e($val) ?></textarea>
        <?php elseif ($type === 'color'): ?>
          <input type="color" id="s-<?= e($key) ?>" name="<?= e($key) ?>" value="<?= e($val) ?>">
        <?php elseif ($type === 'number'): ?>
          <input type="number" id="s-<?= e($key) ?>" name="<?= e($key) ?>" value="<?= e($val) ?>">
        <?php elseif ($type === 'timezone'): ?>
          <select id="s-<?= e($key) ?>" name="<?= e($key) ?>"><?php foreach (DateTimeZone::listIdentifiers() as $tz): ?><option <?= $tz === $val ? 'selected' : '' ?>><?= e($tz) ?></option><?php endforeach; ?></select>
        <?php elseif (str_starts_with($type, 'select:')): ?>
          <select id="s-<?= e($key) ?>" name="<?= e($key) ?>"><?php foreach (explode(',', substr($type, 7)) as $o): ?><option <?= $o === $val ? 'selected' : '' ?>><?= e($o) ?></option><?php endforeach; ?></select>
        <?php elseif ($type === 'image'): ?>
          <div class="img-field"><input type="text" id="s-<?= e($key) ?>" name="<?= e($key) ?>" value="<?= e($val) ?>" placeholder="https://…"><button type="button" class="btn btn-sm" data-pick="#s-<?= e($key) ?>">Choose / upload</button><?php if ($val): ?><img src="<?= e($val) ?>" class="thumb" alt=""><?php endif; ?></div>
        <?php else: ?>
          <input type="text" id="s-<?= e($key) ?>" name="<?= e($key) ?>" value="<?= e($val) ?>">
        <?php endif; ?>
      <?php endif; ?>
      <?php if ($help): ?><small class="help"><?= e($help) ?></small><?php endif; ?>
    </div>
  <?php endforeach; ?>
  </div>
  <div class="form-actions"><button class="btn btn-primary">Save settings</button></div>
</form>
<?php include __DIR__ . '/media_modal.php'; ?>
