<?php if (!empty($faqs)): ?>
<section class="section">
  <div class="container narrow">
    <div class="section-head center"><h2>Frequently asked questions</h2></div>
    <div class="faq">
      <?php foreach ($faqs as $f): ?>
        <details class="reveal"><summary><?= e($f['question']) ?></summary><div class="faq-a"><?= nl2br(e($f['answer'])) ?></div></details>
      <?php endforeach; ?>
    </div>
  </div>
  <script type="application/ld+json"><?= json_encode(['@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => array_map(fn($f) => ['@type' => 'Question', 'name' => $f['question'], 'acceptedAnswer' => ['@type' => 'Answer', 'text' => $f['answer']]], $faqs)], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) ?></script>
</section>
<?php endif; ?>
