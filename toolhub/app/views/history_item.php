<a class="back" href="<?= h(url('history')) ?>">← Usage history</a>
<h1 class="page-title"><?= h($item['icon']) ?> <?= h($item['name']) ?></h1>
<p class="muted"><?= h(fmt_time($item['created_at'])) ?> · <?= h($item['status']) ?> · <a href="<?= h(url('tools/' . $item['slug'])) ?>">Run again</a></p>
<div class="two-col">
  <section class="card"><h2>Input</h2><pre class="pre"><?= h($item['input_text']) ?></pre></section>
  <section class="card output">
    <div class="card-head"><h2>Result</h2><?php if ($item['status'] === 'success' && $item['type'] !== 'seo_keywords'): ?><button class="btn btn-light btn-sm" type="button" data-copy="#result-text">Copy</button><?php endif; ?></div>
    <?php if ($item['status'] !== 'success'): ?>
      <p class="muted"><?= h($item['error'] ?: 'No result.') ?></p>
    <?php elseif ($item['type'] === 'seo_keywords'): ?>
      <?php $result = ['rows' => json_decode((string) $item['output_text'], true) ?: []]; require __DIR__ . '/partials/keyword_table.php'; ?>
    <?php else: ?>
      <div class="md"><?= render_markdown((string) $item['output_text']) ?></div>
      <textarea id="result-text" class="visually-hidden" readonly><?= h($item['output_text']) ?></textarea>
    <?php endif; ?>
  </section>
</div>
