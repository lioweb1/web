<?php
/** @var string $content */
$siteName = setting('site_name');
$pageTitle = isset($title) && $title !== '' ? $title : $siteName;
if (!str_contains($pageTitle, $siteName)) {
    $pageTitle .= ' | ' . $siteName;
}
$desc = $metaDescription ?? setting('tagline');
$me = current_user();
$premium = user_is_premium($me);
$nav = [
    '' => 'Home',
    'signals' => 'Live Signals',
    'results' => 'Results',
    'markets' => 'Markets',
    'tools' => 'Tools',
    'blog' => 'Analysis',
    'brokers' => 'Brokers',
    'pricing' => 'Premium',
];
$reqPath = trim(substr(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/', strlen(rtrim(parse_url(BASE_URL, PHP_URL_PATH) ?: '', '/'))), '/');
$current = explode('/', $reqPath)[0];
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<script>document.documentElement.className+=" js"</script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($pageTitle) ?></title>
<meta name="description" content="<?= e($desc) ?>">
<meta property="og:title" content="<?= e($pageTitle) ?>">
<meta property="og:description" content="<?= e($desc) ?>">
<meta property="og:type" content="website">
<?php if (!empty($ogImage)): ?><meta property="og:image" content="<?= e($ogImage) ?>"><?php endif; ?>
<?php if (setting('favicon_url')): ?><link rel="icon" href="<?= e(setting('favicon_url')) ?>"><?php endif; ?>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="<?= asset('css/style.css') ?>">
<?php if (setting('pwa_enabled') === '1'): ?>
<link rel="manifest" href="<?= e(url('manifest.webmanifest')) ?>">
<meta name="theme-color" content="#070b14">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="<?= e(setting('favicon_url') ?: asset('img/icon.svg')) ?>">
<?php endif; ?>
<?php if (!setting('favicon_url')): ?><link rel="icon" type="image/svg+xml" href="<?= asset('img/icon.svg') ?>"><?php endif; ?>
<style>:root{--primary:<?= e(setting('primary_color', '#22c55e')) ?>;--accent:<?= e(setting('accent_color', '#3b82f6')) ?>}<?= setting('custom_css') ?></style>
<?= setting('head_code') ?>
</head>
<body>
<?= setting('body_start_code') ?>
<?php
$annEnds = setting('announce_ends');
$annOn = setting('announce_enabled') === '1' && setting('announce_text') !== '' && ($annEnds === '' || strtotime($annEnds . ' UTC') > time());
if ($annOn): ?>
<div class="announce" id="announce">
  <div class="container announce-in">
    <span><?= e(setting('announce_text')) ?></span>
    <?php if ($annEnds !== ''): ?><span class="announce-timer promo-countdown" data-expires="<?= e(iso_utc(gmdate('Y-m-d H:i:s', strtotime($annEnds . ' UTC')))) ?>" data-long="1">--:--</span><?php endif; ?>
    <?php if (setting('announce_link') !== ''): ?><a class="btn btn-sm btn-gold" href="<?= e(setting('announce_link')) ?>"><?= e(setting('announce_cta') ?: 'Learn more') ?></a><?php endif; ?>
    <button class="announce-x" aria-label="Close" onclick="this.closest('.announce').remove();try{sessionStorage.setItem('ann_closed','1')}catch(e){}">×</button>
  </div>
</div>
<script>try{if(sessionStorage.getItem('ann_closed'))document.getElementById('announce').remove()}catch(e){}</script>
<?php endif; ?>
<header class="site-header">
  <div class="container nav-wrap">
    <a class="brand" href="<?= e(url()) ?>">
      <?php if (setting('logo_url')): ?><img src="<?= e(setting('logo_url')) ?>" alt="<?= e($siteName) ?>"><?php else: ?><span class="brand-mark">▲</span><?= e($siteName) ?><?php endif; ?>
    </a>
    <button class="nav-toggle" aria-label="Menu" onclick="document.body.classList.toggle('nav-open')">☰</button>
    <nav class="main-nav">
      <?php foreach ($nav as $href => $label): ?>
        <a href="<?= e(url($href)) ?>" class="<?= $current === $href ? 'active' : '' ?>"><?= e($label) ?></a>
      <?php endforeach; ?>
      <?php foreach (menu_pages() as $mp): ?>
        <a href="<?= e(url('p/' . $mp['slug'])) ?>"><?= e($mp['title']) ?></a>
      <?php endforeach; ?>
      <span class="nav-sep"></span>
      <?php if ($me): ?>
        <?php if ($me['role'] === 'admin'): ?><a href="<?= e(url('admin/')) ?>">Admin</a><?php endif; ?>
        <a href="<?= e(url('dashboard')) ?>" class="btn btn-sm <?= $premium ? 'btn-gold' : 'btn-outline' ?>"><?= $premium ? '⭐ ' : '' ?><?= e(explode(' ', $me['name'])[0]) ?></a>
      <?php else: ?>
        <a href="<?= e(url('login')) ?>">Log in</a>
        <a href="<?= e(url('register')) ?>" class="btn btn-sm btn-primary">Join free</a>
      <?php endif; ?>
    </nav>
  </div>
</header>

<?php if (setting('show_ticker') === '1' && lines(setting('ticker_symbols'))):
    $sym = [];
    foreach (lines(setting('ticker_symbols')) as $l) {
        [$pro, $t] = array_pad(explode('|', $l, 2), 2, '');
        $sym[] = ['proName' => trim($pro), 'title' => trim($t) ?: trim($pro)];
    } ?>
<div class="ticker">
  <div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div>
  <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js" async><?= json_encode(['symbols' => $sym, 'showSymbolLogo' => true, 'colorTheme' => 'dark', 'isTransparent' => true, 'displayMode' => 'adaptive', 'locale' => 'en'], JSON_UNESCAPED_SLASHES) ?></script>
  </div>
</div>
<?php endif; ?>

<?php if (setting('ad_top')): ?><div class="container ad-slot"><?= setting('ad_top') ?></div><?php endif; ?>

<main>
  <?php $fl = flashes(); if ($fl): ?>
  <div class="container flashes">
    <?php foreach ($fl as $f): ?><div class="alert alert-<?= e($f['type']) ?>"><?= e($f['msg']) ?></div><?php endforeach; ?>
  </div>
  <?php endif; ?>
  <?= $content ?>
</main>

<footer class="site-footer">
  <div class="container footer-grid">
    <div>
      <a class="brand" href="<?= e(url()) ?>"><span class="brand-mark">▲</span><?= e($siteName) ?></a>
      <p class="muted"><?= e(setting('tagline')) ?></p>
      <div class="socials">
        <?php foreach (['social_telegram' => 'Telegram', 'social_facebook' => 'Facebook', 'social_youtube' => 'YouTube', 'social_whatsapp' => 'WhatsApp'] as $k => $l): if (setting($k)): ?>
          <a href="<?= e(setting($k)) ?>" target="_blank" rel="noopener"><?= $l ?></a>
        <?php endif; endforeach; ?>
      </div>
    </div>
    <div>
      <h4>Explore</h4>
      <?php foreach ($nav as $href => $label): ?><a href="<?= e(url($href)) ?>"><?= e($label) ?></a><?php endforeach; ?>
    </div>
    <div>
      <h4>Information</h4>
      <?php foreach (menu_pages('in_footer') as $mp): ?><a href="<?= e(url('p/' . $mp['slug'])) ?>"><?= e($mp['title']) ?></a><?php endforeach; ?>
    </div>
    <?php if (setting('optin_enabled') === '1'): ?>
    <div>
      <h4><?= e(setting('optin_title')) ?></h4>
      <?php $optinSource = 'footer'; include APP_ROOT . '/views/partials/optin.php'; ?>
    </div>
    <?php endif; ?>
  </div>
  <div class="container disclaimer">
    <p><?= e(setting('disclaimer')) ?></p>
    <?php if (setting('footer_text')): ?><p><?= setting('footer_text') ?></p><?php endif; ?>
    <p class="muted">© <?= date('Y') ?> <?= e($siteName) ?>. All rights reserved.</p>
  </div>
</footer>

<?php if (setting('optin_enabled') === '1' && setting('optin_popup') === '1' && !$me): ?>
<div class="modal" id="optin-modal" data-delay="<?= (int)setting('optin_popup_delay', '15') ?>" hidden>
  <div class="modal-card">
    <button class="modal-close" aria-label="Close" data-close>×</button>
    <div class="modal-icon">📈</div>
    <h3><?= e(setting('optin_title')) ?></h3>
    <p class="muted"><?= e(setting('optin_text')) ?></p>
    <?php $optinSource = 'popup'; include APP_ROOT . '/views/partials/optin.php'; ?>
  </div>
</div>
<?php endif; ?>

<?php if (!$me): ?>
<div class="mobile-cta"><a class="btn btn-primary btn-block" href="<?= e(url('register')) ?>">Get free signals →</a></div>
<?php endif; ?>
<?php if (chat_enabled()): $chatLimit = chat_limit($me); ?>
<button class="chat-fab" id="chat-fab" aria-label="Open AI chat"><span class="chat-fab-icon">✨</span><span class="chat-fab-label">Ask AI</span></button>
<div class="chat-panel" id="chat-panel" hidden role="dialog" aria-label="<?= e(setting('chat_bot_name')) ?>">
  <div class="chat-head">
    <div class="chat-avatar">✨</div>
    <div><strong><?= e(setting('chat_bot_name')) ?></strong><small><span class="dot"></span> Online · powered by Gemini</small></div>
    <button class="chat-icon" data-chat-reset title="New conversation">↺</button>
    <button class="chat-icon" data-chat-close title="Close">×</button>
  </div>
  <div class="chat-body" id="chat-body">
    <div class="msg bot"><?= nl2br(e(setting('chat_welcome'))) ?></div>
  </div>
  <div class="chat-suggest" id="chat-suggest">
    <?php foreach (array_slice(lines(setting('chat_suggestions')), 0, 4) as $sg): ?><button type="button"><?= e($sg) ?></button><?php endforeach; ?>
  </div>
  <form class="chat-form" id="chat-form">
    <textarea name="message" rows="1" maxlength="1000" placeholder="Ask anything about trading or signals…" required></textarea>
    <button class="chat-send" aria-label="Send">➤</button>
  </form>
  <div class="chat-foot">AI can make mistakes. Not financial advice.<?php if ($chatLimit > 0): ?> · <span id="chat-left"><?= max(0, $chatLimit - chat_used_today($me)) ?></span> messages left today<?php endif; ?></div>
</div>
<?php endif; ?>
<script>window.APP = {base: <?= json_encode(BASE_URL) ?>, csrf: <?= json_encode(csrf_token()) ?>, pwa: <?= setting('pwa_enabled') === '1' ? 'true' : 'false' ?>};</script>
<script src="<?= asset('js/app.js') ?>"></script>
<?php if (setting('custom_js')): ?><script><?= setting('custom_js') ?></script><?php endif; ?>
<?= setting('footer_code') ?>
</body>
</html>
