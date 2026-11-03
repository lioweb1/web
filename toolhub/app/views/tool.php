<a class="back" href="<?= h(url('tools')) ?>">← All tools</a>
<div class="tool-head">
  <div class="tool-icon lg"><?= h($tool['icon']) ?></div>
  <div>
    <h1 class="page-title"><?= h($tool['name']) ?></h1>
    <p class="muted"><?= h($tool['description']) ?> · <strong><?= (int) $tool['credit_cost'] ?> credit(s)</strong> per run · You have <strong><?= number_format((int) $user['credits']) ?></strong></p>
  </div>
</div>
<?php if (!$available): ?><div class="alert alert-error">This tool is temporarily unavailable.</div><?php endif; ?>
<?php if (config('app.require_active_plan', true) && !plan_active($user)): ?>
  <div class="banner"><div><strong>An active plan is needed to use tools.</strong></div><a class="btn btn-primary" href="<?= h(url('plans')) ?>">Buy a plan</a></div>
<?php endif; ?>
<?php if ($error): ?><div class="alert alert-error"><?= h($error) ?></div><?php endif; ?>

<div class="tool-layout">
  <form method="post" class="card form" data-busy-form>
    <?= csrf_field() ?>
    <label><?= h($tool['input_label']) ?>
      <textarea name="input" rows="<?= $tool['type'] === 'seo_keywords' ? 2 : 9 ?>" maxlength="<?= TOOL_MAX_INPUT_CHARS ?>" placeholder="<?= h($tool['input_placeholder']) ?>" required><?= h($input) ?></textarea>
    </label>
    <div class="row">
      <?php if ((int) $tool['show_language'] === 1): ?>
        <label>Output language
          <select name="language"><?php foreach (TOOL_LANGUAGES as $l): ?><option <?= $l === $language ? 'selected' : '' ?>><?= h($l) ?></option><?php endforeach; ?></select>
        </label>
      <?php endif; ?>
      <?php if ((int) $tool['show_tone'] === 1): ?>
        <label>Tone
          <select name="tone"><?php foreach (TOOL_TONES as $t): ?><option <?= $t === $tone ? 'selected' : '' ?>><?= h($t) ?></option><?php endforeach; ?></select>
        </label>
      <?php endif; ?>
    </div>
    <button class="btn btn-success btn-block" type="submit" data-busy-text="Working… this can take up to a minute">Generate (<?= (int) $tool['credit_cost'] ?> credits)</button>
  </form>

  <section class="card output">
    <div class="card-head"><h2>Result</h2><?php if ($result && $result['output'] !== ''): ?><button class="btn btn-light btn-sm" type="button" data-copy="#result-text">Copy</button><?php endif; ?></div>
    <?php if (!$result): ?>
      <p class="muted">Your result will appear here.</p>
    <?php elseif ($result['rows'] !== null): ?>
      <?php require __DIR__ . '/partials/keyword_table.php'; ?>
    <?php else: ?>
      <div class="md"><?= render_markdown($result['output']) ?></div>
      <textarea id="result-text" class="visually-hidden" readonly><?= h($result['output']) ?></textarea>
    <?php endif; ?>
  </section>
</div>
