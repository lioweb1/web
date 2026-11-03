<?php
declare(strict_types=1);

/**
 * Auto Signal Engine
 *
 * Pulls real OHLC candles from free market-data APIs and scores them with
 * classic technical indicators (EMA 9/21/50, RSI 14, MACD 12/26/9, ATR 14).
 *  - Symbols with a slash (EUR/USD, XAU/USD) use Twelve Data (free API key).
 *  - Symbols without a slash (BTCUSDT) use Binance public market data (no key).
 * Signals are technical-analysis output, never a guarantee of profit.
 */
class SignalEngine
{
    private array $cache = [];
    private int $tdCalls = 0;
    private array $log = [];

    public function log(string $msg, string $level = 'info'): void
    {
        $this->log[] = "[$level] $msg";
        try {
            q('INSERT INTO engine_log (level, message) VALUES (?, ?)', [$level, mb_substr($msg, 0, 1000)]);
        } catch (Throwable $e) {
        }
    }

    public function messages(): array
    {
        return $this->log;
    }

    /* -------------------- Market data -------------------- */

    private function http(string $url): ?array
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 20,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_USERAGENT => 'SignalScript/' . APP_VERSION,
            ]);
            $body = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($body === false || $code >= 400) {
                $this->log("HTTP $code for " . preg_replace('/apikey=[^&]+/', 'apikey=***', $url), 'warn');
                return null;
            }
        } else {
            $body = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 20]]));
            if ($body === false) {
                return null;
            }
        }
        $json = json_decode((string)$body, true);
        return is_array($json) ? $json : null;
    }

    /** @return array<int, array{t:int,o:float,h:float,l:float,c:float}> oldest first */
    public static function tfSeconds(string $tf): int
    {
        return ['1min' => 60, '3min' => 180, '5min' => 300, '15min' => 900, '30min' => 1800, '1h' => 3600, '4h' => 14400, '1day' => 86400][$tf] ?? 300;
    }

    /** True once per candle of $tf for the given key (persists across cron runs). */
    private function newCandle(string $key, string $tf): bool
    {
        $bucket = (string)intdiv(time(), self::tfSeconds($tf));
        $k = 'bucket_' . substr(md5($key . '|' . $tf), 0, 12);
        if (setting($k) === $bucket) {
            return false;
        }
        save_setting($k, $bucket);
        return true;
    }

    public function candles(string $symbol, string $interval, int $limit = 300): array
    {
        $symbol = strtoupper(trim($symbol));
        $limit = 300;
        $key = "$symbol|$interval";
        if (isset($this->cache[$key])) {
            return $this->cache[$key];
        }
        $out = str_contains($symbol, '/') ? $this->twelveData($symbol, $interval, $limit) : $this->binance($symbol, $interval, $limit);
        return $this->cache[$key] = $out;
    }

    private function binance(string $symbol, string $interval, int $limit): array
    {
        $map = ['1min' => '1m', '3min' => '3m', '5min' => '5m', '15min' => '15m', '30min' => '30m', '1h' => '1h', '4h' => '4h', '1day' => '1d'];
        $iv = $map[$interval] ?? '5m';
        $q = http_build_query(['symbol' => preg_replace('/[^A-Z0-9]/', '', $symbol), 'interval' => $iv, 'limit' => min(1000, $limit)]);
        $data = $this->http('https://data-api.binance.vision/api/v3/klines?' . $q)
            ?? $this->http('https://api.binance.com/api/v3/klines?' . $q);
        if (!$data || isset($data['code'])) {
            return [];
        }
        $out = [];
        foreach ($data as $k) {
            $out[] = ['t' => intdiv((int)$k[0], 1000), 'o' => (float)$k[1], 'h' => (float)$k[2], 'l' => (float)$k[3], 'c' => (float)$k[4]];
        }
        // Drop the still-forming candle
        array_pop($out);
        return $out;
    }

    private function twelveData(string $symbol, string $interval, int $limit): array
    {
        $key = setting('twelvedata_key');
        if ($key === '') {
            $this->log("Skipped $symbol: add a free Twelve Data API key in Settings → Signal engine.", 'warn');
            return [];
        }
        if ($this->tdCalls >= max(1, (int)setting('max_td_calls', '7'))) {
            $this->log("Skipped $symbol: Twelve Data per-run call limit reached.", 'warn');
            return [];
        }
        $today = gmdate('Ymd');
        $used = setting('td_day') === $today ? (int)setting('td_used', '0') : 0;
        if ($used >= max(1, (int)setting('td_daily_limit', '790'))) {
            $this->log("Skipped $symbol: Twelve Data daily limit reached ($used calls). Use fewer assets or a slower timeframe.", 'warn');
            return [];
        }
        save_setting('td_day', $today);
        save_setting('td_used', (string)($used + 1));
        $this->tdCalls++;
        $data = $this->http('https://api.twelvedata.com/time_series?' . http_build_query([
            'symbol' => $symbol, 'interval' => $interval, 'outputsize' => min(500, $limit + 1),
            'timezone' => 'UTC', 'order' => 'ASC', 'apikey' => $key,
        ]));
        if (!$data || ($data['status'] ?? '') !== 'ok' || empty($data['values'])) {
            $this->log("Twelve Data error for $symbol: " . ($data['message'] ?? 'no data'), 'warn');
            return [];
        }
        $out = [];
        foreach ($data['values'] as $v) {
            $out[] = ['t' => strtotime($v['datetime'] . ' UTC'), 'o' => (float)$v['open'], 'h' => (float)$v['high'], 'l' => (float)$v['low'], 'c' => (float)$v['close']];
        }
        usort($out, fn($a, $b) => $a['t'] <=> $b['t']);
        // Drop the still-forming candle
        array_pop($out);
        return $out;
    }

    /* -------------------- Indicators -------------------- */

    public static function ema(array $v, int $p): array
    {
        $out = [];
        $k = 2 / ($p + 1);
        $prev = null;
        foreach ($v as $i => $x) {
            if ($i < $p - 1) {
                $out[$i] = null;
                continue;
            }
            if ($prev === null) {
                $prev = array_sum(array_slice($v, $i - $p + 1, $p)) / $p;
            } else {
                $prev = $x * $k + $prev * (1 - $k);
            }
            $out[$i] = $prev;
        }
        return $out;
    }

    public static function rsi(array $c, int $p = 14): array
    {
        $out = array_fill(0, count($c), null);
        if (count($c) <= $p) {
            return $out;
        }
        $gain = $loss = 0.0;
        for ($i = 1; $i <= $p; $i++) {
            $d = $c[$i] - $c[$i - 1];
            if ($d > 0) { $gain += $d; } else { $loss -= $d; }
        }
        $gain /= $p;
        $loss /= $p;
        $out[$p] = $loss == 0.0 ? 100.0 : 100 - 100 / (1 + $gain / $loss);
        for ($i = $p + 1, $n = count($c); $i < $n; $i++) {
            $d = $c[$i] - $c[$i - 1];
            $gain = ($gain * ($p - 1) + max($d, 0)) / $p;
            $loss = ($loss * ($p - 1) + max(-$d, 0)) / $p;
            $out[$i] = $loss == 0.0 ? 100.0 : 100 - 100 / (1 + $gain / $loss);
        }
        return $out;
    }

    /** @return array{0:array,1:array,2:array} macd, signal, histogram */
    public static function macd(array $c, int $f = 12, int $s = 26, int $sig = 9): array
    {
        $ef = self::ema($c, $f);
        $es = self::ema($c, $s);
        $macd = [];
        foreach ($c as $i => $_) {
            $macd[$i] = ($ef[$i] !== null && $es[$i] !== null) ? $ef[$i] - $es[$i] : null;
        }
        $valid = array_values(array_filter($macd, fn($x) => $x !== null));
        $offset = count($macd) - count($valid);
        $sigLine = self::ema($valid, $sig);
        $signal = $hist = array_fill(0, count($c), null);
        foreach ($sigLine as $j => $v) {
            if ($v !== null) {
                $signal[$j + $offset] = $v;
                $hist[$j + $offset] = $macd[$j + $offset] - $v;
            }
        }
        return [$macd, $signal, $hist];
    }

    public static function atr(array $candles, int $p = 14): ?float
    {
        $n = count($candles);
        if ($n <= $p) {
            return null;
        }
        $trs = [];
        for ($i = 1; $i < $n; $i++) {
            $h = $candles[$i]['h'];
            $l = $candles[$i]['l'];
            $pc = $candles[$i - 1]['c'];
            $trs[] = max($h - $l, abs($h - $pc), abs($l - $pc));
        }
        $atr = array_sum(array_slice($trs, 0, $p)) / $p;
        for ($i = $p, $m = count($trs); $i < $m; $i++) {
            $atr = ($atr * ($p - 1) + $trs[$i]) / $p;
        }
        return $atr;
    }

    /**
     * Score the latest closed candle.
     * @return array{direction:string,confidence:int,trigger:bool,price:float,atr:?float,analysis:string}|null
     */
    public static function analyze(array $candles): ?array
    {
        if (count($candles) < 60) {
            return null;
        }
        $c = array_column($candles, 'c');
        $n = count($c) - 1;
        $e9 = self::ema($c, 9);
        $e21 = self::ema($c, 21);
        $e50 = self::ema($c, 50);
        $rsi = self::rsi($c, 14);
        [, , $hist] = self::macd($c);
        $atr = self::atr($candles, 14);
        if ($e50[$n] === null || $rsi[$n] === null || $hist[$n] === null || $hist[$n - 1] === null) {
            return null;
        }
        $price = $c[$n];
        $buy = $sell = 0.0;
        $why = [];

        // 1) Fast trend: EMA 9 vs EMA 21 (weight 2)
        if ($e9[$n] > $e21[$n]) { $buy += 2; $why[] = 'EMA 9 above EMA 21'; } else { $sell += 2; $why[] = 'EMA 9 below EMA 21'; }

        // 2) Fresh crossover within the last 3 candles (weight 2, acts as trigger)
        $cross = null;
        for ($i = $n; $i > $n - 3; $i--) {
            if ($e9[$i - 1] === null || $e21[$i - 1] === null) break;
            if ($e9[$i - 1] <= $e21[$i - 1] && $e9[$i] > $e21[$i]) { $cross = 'BUY'; break; }
            if ($e9[$i - 1] >= $e21[$i - 1] && $e9[$i] < $e21[$i]) { $cross = 'SELL'; break; }
        }
        if ($cross === 'BUY') { $buy += 2; $why[] = 'fresh bullish EMA crossover'; }
        if ($cross === 'SELL') { $sell += 2; $why[] = 'fresh bearish EMA crossover'; }

        // 3) Main trend: price vs EMA 50 (weight 1.5)
        if ($price > $e50[$n]) { $buy += 1.5; $why[] = 'price above EMA 50 (uptrend)'; } else { $sell += 1.5; $why[] = 'price below EMA 50 (downtrend)'; }

        // 4) RSI momentum / reversal (weight 1.5)
        $r = $rsi[$n];
        $rPrev = $rsi[$n - 1] ?? $r;
        if ($r >= 50 && $r < 70) { $buy += 1.5; $why[] = sprintf('RSI %.1f bullish momentum', $r); }
        elseif ($r < 50 && $r > 30) { $sell += 1.5; $why[] = sprintf('RSI %.1f bearish momentum', $r); }
        elseif ($r <= 30 && $r > $rPrev) { $buy += 1.5; $why[] = sprintf('RSI %.1f oversold and turning up', $r); }
        elseif ($r >= 70 && $r < $rPrev) { $sell += 1.5; $why[] = sprintf('RSI %.1f overbought and turning down', $r); }
        else { $why[] = sprintf('RSI %.1f extreme (caution)', $r); }

        // 5) MACD histogram direction (weight 2, sign flip acts as trigger)
        $h = $hist[$n];
        $hp = $hist[$n - 1];
        $flip = null;
        if ($hp <= 0 && $h > 0) $flip = 'BUY';
        if ($hp >= 0 && $h < 0) $flip = 'SELL';
        if ($h > 0 && $h >= $hp) { $buy += 2; $why[] = 'MACD histogram positive and rising'; }
        elseif ($h < 0 && $h <= $hp) { $sell += 2; $why[] = 'MACD histogram negative and falling'; }
        elseif ($h > 0) { $buy += 0.5; $why[] = 'MACD positive but fading'; }
        else { $sell += 0.5; $why[] = 'MACD negative but fading'; }

        // 6) Candle body confirmation (weight 1)
        $last = $candles[$n];
        if ($last['c'] > $last['o']) { $buy += 1; $why[] = 'bullish close'; } elseif ($last['c'] < $last['o']) { $sell += 1; $why[] = 'bearish close'; }

        $max = 10.0;
        $dir = $buy >= $sell ? 'BUY' : 'SELL';
        $edge = abs($buy - $sell) / $max;           // 0..1
        $confidence = (int)round(50 + $edge * 45);  // 50..95
        $trigger = ($cross === $dir) || ($flip === $dir);

        return [
            'direction' => $dir,
            'confidence' => max(50, min(95, $confidence)),
            'trigger' => $trigger,
            'price' => $price,
            'atr' => $atr,
            'analysis' => ucfirst(implode(', ', $why)) . '.' . ($atr ? ' ATR(14): ' . fmt_price($atr) . '.' : ''),
        ];
    }

    /* -------------------- Generation -------------------- */

    public function generate(): int
    {
        $created = 0;
        $groups = [
            'binary' => [lines(setting('binary_assets')), setting('binary_timeframe', '1min')],
            'forex' => [lines(setting('forex_assets')), setting('forex_timeframe', '15min')],
            'crypto' => [lines(setting('crypto_assets')), setting('crypto_timeframe', '15min')],
        ];
        $min = (int)setting('min_confidence', '65');
        $premiumAt = (int)setting('premium_confidence', '78');

        foreach ($groups as $market => [$assets, $tf]) {
            if (!$assets || !$this->newCandle('gen_' . $market, $tf)) {
                continue; // wait for the next candle close (saves API calls)
            }
            foreach ($assets as $asset) {
                $asset = strtoupper($asset);
                if (q_val("SELECT id FROM signals WHERE market = ? AND asset = ? AND status = 'active' LIMIT 1", [$market, $asset])) {
                    continue; // one open signal per asset
                }
                $candles = $this->candles($asset, $tf);
                $a = self::analyze($candles);
                if (!$a) {
                    continue;
                }
                if (!$a['trigger'] || $a['confidence'] < $min) {
                    continue;
                }
                $created += $this->createSignal($market, $asset, $tf, $a, $a['confidence'] >= $premiumAt);
            }
        }
        return $created;
    }

    private function createSignal(string $market, string $asset, string $tf, array $a, bool $premium): int
    {
        $price = $a['price'];
        $atr = $a['atr'] ?: $price * 0.002;
        $sign = $a['direction'] === 'BUY' ? 1 : -1;
        $sl = $tp = $tp2 = null;
        if ($market === 'binary') {
            $expiryMin = max(1, (int)setting('binary_expiry', '5'));
        } else {
            $expiryMin = max(1, (int)setting('forex_expiry_hours', '24')) * 60;
            $sl = $price - $sign * 1.5 * $atr;
            $tp = $price + $sign * 1.5 * $atr;
            $tp2 = $price + $sign * 3.0 * $atr;
        }
        q('INSERT INTO signals (market, asset, direction, timeframe, entry, stop_loss, take_profit, take_profit2, expiry_minutes, expires_at, confidence, analysis, is_premium, source, status, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
            $market, $asset, $a['direction'], $tf, $price, $sl, $tp, $tp2, $expiryMin,
            gmdate('Y-m-d H:i:s', time() + $expiryMin * 60), $a['confidence'], $a['analysis'], $premium ? 1 : 0, 'auto', 'active', now_utc(),
        ]);
        $id = (int)db()->lastInsertId();
        $this->log(sprintf('New %s signal #%d %s %s @ %s (%d%%)', $market, $id, $asset, $a['direction'], fmt_price($price), $a['confidence']));
        return 1;
    }

    /* -------------------- Result tracking -------------------- */

    public function evaluate(): int
    {
        $closed = 0;
        $open = q("SELECT * FROM signals WHERE status = 'active' ORDER BY id")->fetchAll();
        foreach ($open as $s) {
            $expired = strtotime($s['expires_at'] . ' UTC') <= time();
            if ($s['market'] === 'binary') {
                if (!$expired) {
                    continue;
                }
                $close = $this->priceAt($s['asset'], $s['timeframe'], strtotime($s['expires_at'] . ' UTC'));
                if ($close === null) {
                    if (time() - strtotime($s['expires_at'] . ' UTC') > 3600) {
                        $this->close($s, 'expired', null);
                        $closed++;
                    }
                    continue;
                }
                $entry = (float)$s['entry'];
                $win = $s['direction'] === 'BUY' ? $close > $entry : $close < $entry;
                $this->close($s, $win ? 'win' : 'loss', $close);
                $closed++;
                continue;
            }

            // forex / crypto: check SL / TP hit on candles since creation
            if ($s['stop_loss'] === null || $s['take_profit'] === null) {
                if ($expired) { $this->close($s, 'expired', null); $closed++; }
                continue; // manual signal without levels: admin closes it
            }
            if (!$expired && !$this->newCandle('eval_' . $s['id'], $s['timeframe'])) {
                continue;
            }
            $candles = $this->candles($s['asset'], $s['timeframe']);
            if (!$candles) {
                continue;
            }
            $created = strtotime($s['created_at'] . ' UTC');
            $isBuy = $s['direction'] === 'BUY';
            $sl = (float)$s['stop_loss'];
            $tp = (float)$s['take_profit'];
            $result = null;
            $price = null;
            foreach ($candles as $k) {
                if ($k['t'] < $created) continue;
                if ($isBuy) {
                    if ($k['l'] <= $sl) { $result = 'loss'; $price = $sl; break; }
                    if ($k['h'] >= $tp) { $result = 'win'; $price = $tp; break; }
                } else {
                    if ($k['h'] >= $sl) { $result = 'loss'; $price = $sl; break; }
                    if ($k['l'] <= $tp) { $result = 'win'; $price = $tp; break; }
                }
            }
            if ($result) {
                $this->close($s, $result, $price);
                $closed++;
            } elseif ($expired) {
                $last = end($candles)['c'];
                $entry = (float)$s['entry'];
                $this->close($s, ($isBuy ? $last > $entry : $last < $entry) ? 'win' : 'loss', $last);
                $closed++;
            }
        }
        return $closed;
    }

    private function priceAt(string $asset, string $tf, int $ts): ?float
    {
        // Crypto: 1-minute candles are free (Binance). Forex: reuse the signal's timeframe to save API credits.
        $tf = str_contains($asset, '/') ? $tf : '1min';
        $sec = self::tfSeconds($tf);
        $candles = $this->candles($asset, $tf);
        $best = null;
        foreach ($candles as $k) {
            // last candle that closes at or right before expiry (30s tolerance)
            if ($k['t'] + $sec <= $ts + 30) {
                $best = $k['c'];
            }
        }
        // Only trust it once the data actually reaches the expiry time
        $lastClose = $candles ? end($candles)['t'] + $sec : 0;
        return ($best !== null && $lastClose >= $ts - 30) ? $best : null;
    }

    private function close(array $s, string $status, ?float $price): void
    {
        q('UPDATE signals SET status = ?, close_price = ?, closed_at = ? WHERE id = ?', [$status, $price, now_utc(), $s['id']]);
        $this->log(sprintf('Signal #%d %s %s closed: %s', $s['id'], $s['asset'], $s['direction'], strtoupper($status)));
        if (setting('telegram_results') === '1' && in_array($status, ['win', 'loss'], true)) {
            $s['status'] = $status;
            $s['close_price'] = $price;
            telegram_result($s);
        }
    }

    public function run(): array
    {
        $closed = $this->evaluate();
        $created = setting('auto_enabled') === '1' ? $this->generate() : 0;
        $sent = telegram_flush();
        save_setting('last_cron', now_utc());
        q('DELETE FROM engine_log WHERE created_at < ?', [gmdate('Y-m-d H:i:s', time() - 7 * 86400)]);
        return ['created' => $created, 'closed' => $closed, 'telegram' => $sent];
    }
}

/* -------------------- Telegram -------------------- */

function telegram_send(string $chat, string $html): bool
{
    $token = setting('telegram_bot_token');
    if ($token === '' || $chat === '' || !function_exists('curl_init')) {
        return false;
    }
    $ch = curl_init('https://api.telegram.org/bot' . $token . '/sendMessage');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_POSTFIELDS => ['chat_id' => $chat, 'text' => $html, 'parse_mode' => 'HTML', 'disable_web_page_preview' => 'true'],
    ]);
    $res = json_decode((string)curl_exec($ch), true);
    curl_close($ch);
    return !empty($res['ok']);
}

function telegram_signal_text(array $s): string
{
    $arrow = $s['direction'] === 'BUY' ? '🟢' : '🔴';
    $t = "$arrow <b>" . htmlspecialchars(strtoupper($s['market'])) . ' SIGNAL</b>' . ((int)$s['is_premium'] ? ' ⭐ PREMIUM' : '') . "\n\n";
    $t .= '<b>' . htmlspecialchars($s['asset']) . '</b> — <b>' . signal_label($s) . "</b>\n";
    $t .= 'Entry: <code>' . fmt_price($s['entry']) . "</code>\n";
    if ($s['market'] === 'binary') {
        $t .= 'Expiry: ' . (int)$s['expiry_minutes'] . " min\n";
    } else {
        if ($s['stop_loss'] !== null) $t .= 'Stop loss: <code>' . fmt_price($s['stop_loss']) . "</code>\n";
        if ($s['take_profit'] !== null) $t .= 'Take profit 1: <code>' . fmt_price($s['take_profit']) . "</code>\n";
        if ($s['take_profit2'] !== null) $t .= 'Take profit 2: <code>' . fmt_price($s['take_profit2']) . "</code>\n";
    }
    $t .= 'Timeframe: ' . htmlspecialchars($s['timeframe']) . ' · Confidence: ' . (int)$s['confidence'] . "%\n\n";
    $t .= '🔗 ' . url('signal/' . $s['id']) . "\n";
    $t .= '<i>Not financial advice. Trade at your own risk.</i>';
    return $t;
}

/** Send any not-yet-posted signals to the configured channels. */
function telegram_flush(): int
{
    if (setting('telegram_bot_token') === '') {
        return 0;
    }
    $sent = 0;
    $rows = q("SELECT * FROM signals WHERE telegram_sent = 0 AND status = 'active' ORDER BY id LIMIT 20")->fetchAll();
    foreach ($rows as $s) {
        $chat = (int)$s['is_premium'] ? setting('telegram_premium_chat') : setting('telegram_free_chat');
        $ok = $chat !== '' && telegram_send($chat, telegram_signal_text($s));
        // Free channel also gets a teaser for premium signals
        if ((int)$s['is_premium'] && setting('telegram_free_chat') !== '') {
            telegram_send(setting('telegram_free_chat'), '⭐ New <b>PREMIUM</b> ' . htmlspecialchars($s['market']) . ' signal on <b>' . htmlspecialchars($s['asset']) . "</b> (" . (int)$s['confidence'] . "% confidence).\nUnlock it: " . url('pricing'));
        }
        q('UPDATE signals SET telegram_sent = 1 WHERE id = ?', [$s['id']]);
        $sent += $ok ? 1 : 0;
    }
    return $sent;
}

function telegram_result(array $s): void
{
    $chat = (int)$s['is_premium'] ? setting('telegram_premium_chat') : setting('telegram_free_chat');
    if ($chat === '') {
        return;
    }
    $icon = $s['status'] === 'win' ? '✅ WIN' : '❌ LOSS';
    telegram_send($chat, "$icon — <b>" . htmlspecialchars($s['asset']) . '</b> ' . signal_label($s) . ' (#' . (int)$s['id'] . ")\nEntry " . fmt_price($s['entry']) . ' → Close ' . fmt_price($s['close_price']));
}
