<a class="back" href="<?= h(url('admin/tools')) ?>">← Tools</a>
<h1 class="page-title"><?= h($title) ?></h1>
<?php foreach ($errors as $e): ?><div class="alert alert-error"><?= h($e) ?></div><?php endforeach; ?>
<form method="post" class="card form">
  <?= csrf_field() ?>
  <div class="row">
    <label>Name<input name="name" value="<?= h($tool['name']) ?>" required maxlength="100"></label>
    <label>Slug (URL)<input name="slug" value="<?= h($tool['slug']) ?>" maxlength="80" placeholder="auto from name"></label>
    <label>Icon (emoji)<input name="icon" value="<?= h($tool['icon']) ?>" maxlength="8"></label>
  </div>
  <div class="row">
    <label>Category<input name="category" value="<?= h($tool['category']) ?>" required maxlength="50"></label>
    <label>Type
      <select name="type"><option value="ai_text" <?= $tool['type'] === 'ai_text' ? 'selected' : '' ?>>AI text (Claude)</option><option value="seo_keywords" <?= $tool['type'] === 'seo_keywords' ? 'selected' : '' ?>>Keyword data (DataForSEO)</option></select>
    </label>
    <label>Credits per run<input type="number" name="credit_cost" value="<?= (int) $tool['credit_cost'] ?>" min="0" max="1000"></label>
    <label>Sort order<input type="number" name="sort" value="<?= (int) $tool['sort'] ?>"></label>
  </div>
  <label>Short description<input name="description" value="<?= h($tool['description']) ?>" maxlength="255"></label>
  <label>AI instructions (system prompt) — what the tool should do with the user's input
    <textarea name="system_prompt" rows="6"><?= h($tool['system_prompt']) ?></textarea>
  </label>
  <div class="row">
    <label>Input label<input name="input_label" value="<?= h($tool['input_label']) ?>" maxlength="120"></label>
    <label>Input placeholder<input name="input_placeholder" value="<?= h($tool['input_placeholder']) ?>" maxlength="255"></label>
  </div>
  <div class="checks">
    <label><input type="checkbox" name="show_language" <?= $tool['show_language'] ? 'checked' : '' ?>> Language selector</label>
    <label><input type="checkbox" name="show_tone" <?= $tool['show_tone'] ? 'checked' : '' ?>> Tone selector</label>
    <label><input type="checkbox" name="is_new" <?= $tool['is_new'] ? 'checked' : '' ?>> "New" ribbon</label>
    <label><input type="checkbox" name="is_active" <?= $tool['is_active'] ? 'checked' : '' ?>> Active</label>
  </div>
  <button class="btn btn-primary" type="submit">Save tool</button>
</form>
