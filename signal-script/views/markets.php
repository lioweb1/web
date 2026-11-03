<?php
function tv_widget(string $name, array $cfg, string $height = '500px'): string
{
    return '<div class="tv-box" style="height:' . $height . '"><div class="tradingview-widget-container" style="height:100%"><div class="tradingview-widget-container__widget" style="height:100%"></div><script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-' . $name . '.js" async>' . json_encode($cfg + ['colorTheme' => 'dark', 'isTransparent' => true, 'locale' => 'en', 'width' => '100%', 'height' => '100%'], JSON_UNESCAPED_SLASHES) . '</script></div></div>';
}
?>
<section class="section">
  <div class="container">
    <div class="section-head"><div><h1>Markets</h1><p class="muted">Live market overview, currency strength heatmap, economic calendar and technical gauges.</p></div>
      <div class="tabs" data-tabs>
        <a href="#overview" class="active">Overview</a><a href="#heatmap">Heatmap</a><a href="#calendar">Calendar</a><a href="#technicals">Technicals</a>
      </div>
    </div>
    <div class="tab-panel" id="overview">
      <div class="grid-2x">
        <?= tv_widget('market-overview', ['dateRange' => '1D', 'showChart' => true, 'showSymbolLogo' => true, 'tabs' => [
            ['title' => 'Forex', 'symbols' => [['s' => 'FX_IDC:EURUSD'], ['s' => 'FX_IDC:GBPUSD'], ['s' => 'FX_IDC:USDJPY'], ['s' => 'FX_IDC:AUDUSD'], ['s' => 'FX_IDC:USDCAD'], ['s' => 'FX_IDC:EURJPY']]],
            ['title' => 'Crypto', 'symbols' => [['s' => 'BINANCE:BTCUSDT'], ['s' => 'BINANCE:ETHUSDT'], ['s' => 'BINANCE:SOLUSDT'], ['s' => 'BINANCE:BNBUSDT'], ['s' => 'BINANCE:XRPUSDT']]],
            ['title' => 'Commodities', 'symbols' => [['s' => 'OANDA:XAUUSD'], ['s' => 'OANDA:XAGUSD'], ['s' => 'TVC:USOIL']]],
        ]], '560px') ?>
        <?= tv_widget('hotlists', ['exchange' => 'US', 'dateRange' => '1D', 'showChart' => true], '560px') ?>
      </div>
    </div>
    <div class="tab-panel" id="heatmap" hidden>
      <?= tv_widget('forex-heat-map', ['currencies' => ['EUR', 'USD', 'JPY', 'GBP', 'CHF', 'AUD', 'CAD', 'NZD']], '520px') ?>
      <h3 class="mt">Cross rates</h3>
      <?= tv_widget('forex-cross-rates', ['currencies' => ['EUR', 'USD', 'JPY', 'GBP', 'CHF', 'AUD', 'CAD', 'NZD']], '420px') ?>
    </div>
    <div class="tab-panel" id="calendar" hidden>
      <?= tv_widget('events', ['importanceFilter' => '0,1', 'countryFilter' => 'us,eu,gb,jp,au,ca,ch,cn,nz'], '720px') ?>
    </div>
    <div class="tab-panel" id="technicals" hidden>
      <div class="tech-grid">
        <?php foreach (['FX_IDC:EURUSD', 'FX_IDC:GBPUSD', 'FX_IDC:USDJPY', 'OANDA:XAUUSD', 'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT'] as $sym): ?>
          <?= tv_widget('technical-analysis', ['interval' => '15m', 'isTransparent' => true, 'symbol' => $sym, 'showIntervalTabs' => true, 'displayMode' => 'single'], '430px') ?>
        <?php endforeach; ?>
      </div>
    </div>
  </div>
</section>
