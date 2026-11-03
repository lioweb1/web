<?php /** @var array $ent */ global $a; ?>
<p><a href="<?= e(admin_url($a)) ?>">← Back to <?= e(strtolower($ent['title'])) ?></a>
<?php if ($row && isset($ent['view']) && !empty($row['id'])): ?> · <a href="<?= e(($ent['view'])($row)) ?>" target="_blank">View on site ↗</a><?php endif; ?></p>
<form method="post" class="card form">
  <?= csrf_field() ?>
  <div class="form-grid">
  <?php foreach ($ent['fields'] as $name => $f):
      $val = $row[$name] ?? ($f['default'] ?? '');
      $wide = in_array($f['type'], ['html', 'textarea', 'code', 'image'], true) ? ' wide' : ''; ?>
    <div class="field<?= $wide ?>">
      <?php if ($f['type'] === 'checkbox'): ?>
        <label class="check"><input type="checkbox" name="<?= e($name) ?>" value="1" <?= (int)$val ? 'checked' : '' ?>> <?= e($f['label']) ?></label>
      <?php else: ?>
        <label for="f-<?= e($name) ?>"><?= e($f['label']) ?><?= !empty($f['required']) ? ' *' : '' ?></label>
        <?php switch ($f['type']):
          case 'select': ?>
            <select id="f-<?= e($name) ?>" name="<?= e($name) ?>">
              <?php foreach ($f['options'] as $k => $l): ?><option value="<?= e($k) ?>" <?= (string)$val === (string)$k ? 'selected' : '' ?>><?= e($l) ?></option><?php endforeach; ?>
            </select>
          <?php break; case 'textarea': ?>
            <textarea id="f-<?= e($name) ?>" name="<?= e($name) ?>" rows="4"><?= e($val) ?></textarea>
          <?php break; case 'code': ?>
            <textarea id="f-<?= e($name) ?>" name="<?= e($name) ?>" rows="8" class="code" spellcheck="false"><?= e($val) ?></textarea>
          <?php break; case 'html': ?>
            <div class="editor" data-editor>
              <div class="ed-bar">
                <button type="button" data-cmd="bold"><b>B</b></button><button type="button" data-cmd="italic"><i>I</i></button><button type="button" data-cmd="underline"><u>U</u></button>
                <button type="button" data-cmd="formatBlock" data-val="H2">H2</button><button type="button" data-cmd="formatBlock" data-val="H3">H3</button><button type="button" data-cmd="formatBlock" data-val="P">¶</button>
                <button type="button" data-cmd="insertUnorderedList">• List</button><button type="button" data-cmd="insertOrderedList">1. List</button><button type="button" data-cmd="formatBlock" data-val="BLOCKQUOTE">❝</button>
                <button type="button" data-cmd="createLink">🔗 Link</button><button type="button" data-cmd="image">🖼 Image</button><button type="button" data-cmd="removeFormat">⌫</button>
                <span class="sp"></span>
                <button type="button" data-mode="visual" class="on">Visual</button><button type="button" data-mode="html">HTML</button>
              </div>
              <div class="ed-visual" contenteditable="true"></div>
              <textarea id="f-<?= e($name) ?>" name="<?= e($name) ?>" class="code ed-html" rows="18" spellcheck="false"><?= e($val) ?></textarea>
            </div>
          <?php break; case 'image': ?>
            <div class="img-field">
              <input type="text" id="f-<?= e($name) ?>" name="<?= e($name) ?>" value="<?= e($val) ?>" placeholder="https://…">
              <button type="button" class="btn btn-sm" data-pick="#f-<?= e($name) ?>">Choose / upload</button>
              <?php if ($val): ?><img src="<?= e($val) ?>" alt="" class="thumb"><?php endif; ?>
            </div>
          <?php break; case 'datetime': ?>
            <input type="datetime-local" id="f-<?= e($name) ?>" name="<?= e($name) ?>" value="<?= $val ? e(str_replace(' ', 'T', substr((string)$val, 0, 16))) : '' ?>">
          <?php break; case 'number': ?>
            <input type="number" id="f-<?= e($name) ?>" name="<?= e($name) ?>" value="<?= e($val) ?>">
          <?php break; case 'decimal': ?>
            <input type="text" inputmode="decimal" id="f-<?= e($name) ?>" name="<?= e($name) ?>" value="<?= e($val === null ? '' : rtrim(rtrim((string)$val, '0'), '.')) ?>">
          <?php break; default: ?>
            <input type="<?= $f['type'] === 'url' ? 'url' : 'text' ?>" id="f-<?= e($name) ?>" name="<?= e($name) ?>" value="<?= e($val) ?>">
        <?php endswitch; ?>
      <?php endif; ?>
      <?php if (!empty($f['help'])): ?><small class="help"><?= e($f['help']) ?></small><?php endif; ?>
    </div>
  <?php endforeach; ?>
  </div>
  <div class="form-actions">
    <button class="btn btn-primary">Save</button>
    <button class="btn" name="save_close" value="1">Save & close</button>
  </div>
</form>
<?php include __DIR__ . '/media_modal.php'; ?>
