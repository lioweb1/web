import { createServer, type Server } from "node:http";
import { RISK, STRATEGY, SYMBOLS } from "./config.ts";
import type { NewsEvent } from "./news.ts";
import type { PaperState } from "./paper.ts";
import type { Report } from "./backtest.ts";

export interface DashboardSource {
  state: () => PaperState;
  backtest: () => Report | null;
  news: () => NewsEvent[];
  setPaused: (paused: boolean) => void;
  telegram: boolean;
  /** URLs to show for opening the dashboard from a phone (set when listening on the LAN). */
  lanUrls?: string[];
}

/**
 * Web dashboard. Binds to 127.0.0.1 by default so only this computer can open it; pass
 * host "0.0.0.0" to also allow phones on the same Wi-Fi (anyone on that network can then
 * see and pause the bot).
 */
export function startDashboard(src: DashboardSource, port: number, host = "127.0.0.1"): Promise<Server> {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(HTML);
    }
    if (req.method === "GET" && url === "/api/state") {
      const body = {
        state: src.state(),
        backtest: src.backtest(),
        news: src.news().filter((n) => n.time > Date.now() - 3600_000).slice(0, 12),
        settings: {
          strategy: STRATEGY,
          risk: RISK,
          symbols: SYMBOLS.map((s) => s.name),
          telegram: src.telegram,
          lanUrls: src.lanUrls ?? [],
        },
        now: Date.now(),
      };
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(body));
    }
    if (req.method === "POST" && (url === "/api/pause" || url === "/api/resume")) {
      src.setPaused(url === "/api/pause");
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(404);
    res.end("Not found");
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

const HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#2f5bd3">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Signals">
<title>Forex Signal Bot</title>
<style>
:root {
  --bg: #f6f7f9; --panel: #ffffff; --text: #16191d; --muted: #66707c; --line: #e3e6ea;
  --up: #0f8a5f; --down: #c93a3a; --accent: #2f5bd3; --warn: #b7791f; --chip: #eef1f5;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0e1116; --panel: #161b22; --text: #e6e9ee; --muted: #8b95a3; --line: #262d36;
    --up: #34c38f; --down: #f06a6a; --accent: #6d8ff0; --warn: #e0a84a; --chip: #1f2630; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1280px; margin: 0 auto; padding: 20px 16px 48px; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; justify-content: space-between; margin-bottom: 16px; }
h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 10px; font-weight: 600; }
.status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; color: var(--muted); font-size: 13px; }
.status button, .status select { white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--up); display: inline-block; }
.dot.paused { background: var(--warn); }
button { font: inherit; border: 1px solid var(--line); background: var(--panel); color: var(--text);
  padding: 6px 12px; border-radius: 6px; cursor: pointer; }
button:hover { border-color: var(--accent); }
button.on { border-color: var(--up); color: var(--up); }
select { font: inherit; border: 1px solid var(--line); background: var(--panel); color: var(--text); padding: 6px 8px; border-radius: 6px; }
.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: var(--panel); border: 1px solid var(--line);
  border-left: 4px solid var(--accent); border-radius: 8px; padding: 12px 16px; font-size: 15px; font-weight: 600; box-shadow: 0 6px 24px rgba(0,0,0,.18); z-index: 9; max-width: calc(100vw - 32px); }
.toast.BUY { border-left-color: var(--up); } .toast.SELL { border-left-color: var(--down); }
.banner { background: var(--chip); border: 1px solid var(--line); border-left: 3px solid var(--warn);
  padding: 10px 12px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; }
.grid { display: grid; gap: 12px; }
.kpis { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-bottom: 12px; }
.two { grid-template-columns: 2fr 1fr; }
@media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; min-width: 0; }
.kpi .label { color: var(--muted); font-size: 12px; }
.kpi .value { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; }
.kpi .sub { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.pos { color: var(--up); } .neg { color: var(--down); }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 13px; }
th { text-align: left; color: var(--muted); font-weight: 500; font-size: 12px; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 7px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
.side { font-weight: 600; } .BUY { color: var(--up); } .SELL { color: var(--down); }
.chip { display: inline-block; background: var(--chip); border-radius: 4px; padding: 1px 6px; font-size: 12px; }
.bar { display: inline-block; width: 60px; height: 6px; background: var(--chip); border-radius: 3px; vertical-align: middle; margin-right: 6px; overflow: hidden; }
.bar > i { display: block; height: 100%; background: var(--accent); }
.empty { color: var(--muted); padding: 14px 0; text-align: center; }
svg { display: block; width: 100%; height: auto; }
.section { margin-top: 12px; }
.muted { color: var(--muted); }
details summary { cursor: pointer; color: var(--muted); }
</style>
</head>
<body>
<main>
  <header>
    <h1>Forex Signal Bot</h1>
    <div class="status"><span id="dot" class="dot"></span><span id="statusText">Loading…</span>
      <select id="voice" title="Voice language"><option value="en-US">English voice</option><option value="bn-BD">Bangla voice</option></select>
      <button id="alerts">🔕 Enable alerts</button>
      <button id="toggle">Pause</button></div>
  </header>
  <div id="alertHint" class="banner">Tap <b>Enable alerts</b> once so this browser can play a sound and <b>say "Buy" or "Sell"</b> when a signal comes. Keep this tab open (on a phone, keep the screen on or use Telegram, which also alerts when the phone is locked).</div>
  <div id="lan" class="banner" hidden></div>
  <div id="demo" class="banner" hidden>DEMO MODE: this dashboard is filled with <b>synthetic random data</b> so you can see the layout. These numbers say nothing about real performance. Run <code>npm run backtest</code> and <code>npm run live</code> for real data.</div>
  <div class="grid kpis" id="kpis"></div>
  <div class="grid two">
    <div class="card"><h2>Paper account equity</h2><div id="equity"></div></div>
    <div class="card"><h2>Upcoming high-impact news</h2><div id="news"></div></div>
  </div>
  <div class="card section"><h2>Open trades</h2><div class="scroll" id="open"></div></div>
  <div class="card section"><h2>Latest signals</h2><div class="scroll" id="signals"></div></div>
  <div class="card section"><h2>Closed trades</h2><div class="scroll" id="closed"></div></div>
  <div class="card section"><h2>Backtest</h2><div id="backtest"></div></div>
  <p class="muted" style="font-size:12px;margin-top:16px">Strength score shows how many quality checks agree. It is not a win probability. Paper trading only, no real orders. Not financial advice.</p>
</main>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const usd = (v) => (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const r = (v) => (v > 0 ? "+" : "") + v.toFixed(2) + "R";
const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const t = (ms) => new Date(ms).toISOString().slice(5, 16).replace("T", " ");
const digits = (sym) => (sym.includes("JPY") ? 3 : sym === "XAUUSD" ? 2 : 5);
const px = (sym, v) => v.toFixed(digits(sym));
let paused = false;

// ---------- Alerts: sound, voice ("Buy EURUSD"), notification, on-screen toast ----------
let alertsOn = false, audioCtx = null, lastSignalKey = null, lastClosedCount = null, wakeLock = null;
const voiceSel = $("voice");
try { voiceSel.value = localStorage.getItem("voice") || "en-US"; } catch (e) {}
voiceSel.onchange = () => { try { localStorage.setItem("voice", voiceSel.value); } catch (e) {} };
const bn = () => voiceSel.value.startsWith("bn");

function beep(kind) {
  if (!audioCtx) return;
  const notes = kind === "BUY" ? [660, 880, 1100] : kind === "SELL" ? [880, 660, 440] : [520];
  notes.forEach((f, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
    const t0 = audioCtx.currentTime + i * 0.2;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    o.start(t0); o.stop(t0 + 0.2);
  });
}
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voiceSel.value; u.rate = 0.95;
  const want = voiceSel.value.toLowerCase().slice(0, 2);
  const v = speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith(want));
  if (v) u.voice = v;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
const spell = (sym) => sym.split("").join(" ");
function signalSpeech(s) {
  const pair = spell(s.symbol);
  if (bn()) return (s.side === "BUY" ? "কিনুন" : "বিক্রি করুন") + ", " + pair + ". এন্ট্রি " + px(s.symbol, s.entry) + ". স্টপ লস " + px(s.symbol, s.stopLoss) + ". টেক প্রফিট " + px(s.symbol, s.tp2) + ".";
  return (s.side === "BUY" ? "Buy" : "Sell") + " signal, " + pair + ". Entry " + px(s.symbol, s.entry) + ". Stop loss " + px(s.symbol, s.stopLoss) + ". Take profit " + px(s.symbol, s.tp2) + ". Strength " + s.score + ".";
}
function closeSpeech(x) {
  const res = x.result.r > 0 ? (bn() ? "লাভ" : "profit") : x.result.r < 0 ? (bn() ? "লস" : "loss") : (bn() ? "ব্রেক ইভেন" : "breakeven");
  return spell(x.symbol) + (bn() ? " ট্রেড বন্ধ হয়েছে, " : " trade closed, ") + res + ", " + r(x.result.r).replace("R", " R");
}
function toast(text, kind) {
  const el = document.createElement("div");
  el.className = "toast " + (kind || ""); el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 12000);
}
function notify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try { new Notification(title, { body, tag: title }); } catch (e) {}
}
function announceSignal(s) {
  const title = (s.side === "BUY" ? "🟢 BUY " : "🔴 SELL ") + s.symbol + (s.status === "BLOCKED" ? " (skipped)" : "");
  const body = "Entry " + px(s.symbol, s.entry) + "  SL " + px(s.symbol, s.stopLoss) + "  TP " + px(s.symbol, s.tp2) + "  score " + s.score + (s.reason ? "  · " + s.reason : "");
  toast(title + " · " + body, s.side);
  notify(title, body);
  if (!alertsOn) return;
  beep(s.side);
  setTimeout(() => speak(signalSpeech(s) + (s.status === "BLOCKED" ? (bn() ? " এই ট্রেড নেওয়া হয়নি।" : " Trade skipped.") : "")), 700);
}
function announceClose(x) {
  toast((x.result.r > 0 ? "✅ " : x.result.r < 0 ? "❌ " : "⚪ ") + x.symbol + " closed " + r(x.result.r) + " (" + usd(x.pnlUSD) + ")");
  notify(x.symbol + " closed " + r(x.result.r), x.result.outcome + " · " + usd(x.pnlUSD));
  if (!alertsOn) return;
  beep("CLOSE");
  setTimeout(() => speak(closeSpeech(x)), 400);
}
function checkAlerts(st) {
  const sigs = st.signals, latest = sigs[sigs.length - 1];
  const key = latest ? latest.id + latest.status : "";
  if (lastSignalKey === null) lastSignalKey = key;
  else if (key !== lastSignalKey) {
    const fresh = [];
    for (let i = sigs.length - 1; i >= 0 && sigs[i].id + sigs[i].status !== lastSignalKey; i--) fresh.unshift(sigs[i]);
    lastSignalKey = key;
    fresh.slice(-3).forEach((s, i) => setTimeout(() => announceSignal(s), i * 9000));
  }
  if (lastClosedCount === null) lastClosedCount = st.closed.length;
  else if (st.closed.length > lastClosedCount) {
    st.closed.slice(lastClosedCount).slice(-3).forEach((x, i) => setTimeout(() => announceClose(x), 2000 + i * 6000));
    lastClosedCount = st.closed.length;
  }
}
$("alerts").onclick = async () => {
  if (alertsOn) {
    alertsOn = false; $("alerts").textContent = "🔕 Enable alerts"; $("alerts").className = "";
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    return;
  }
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); await audioCtx.resume(); } catch (e) {}
  if ("speechSynthesis" in window) { speechSynthesis.getVoices(); speechSynthesis.speak(new SpeechSynthesisUtterance(" ")); }
  if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch (e) {} }
  try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}
  alertsOn = true; $("alerts").textContent = "🔔 Alerts on"; $("alerts").className = "on"; $("alertHint").hidden = true;
  beep("BUY");
  setTimeout(() => speak(bn() ? "অ্যালার্ট চালু হয়েছে। সিগন্যাল এলে আমি বলব কিনুন অথবা বিক্রি করুন।" : "Alerts on. I will say buy or sell when a signal comes."), 700);
};
document.addEventListener("visibilitychange", async () => {
  if (alertsOn && document.visibilityState === "visible" && navigator.wakeLock && !wakeLock) { try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {} }
});

function table(rows, cols, empty) {
  if (!rows.length) return '<div class="empty">' + empty + "</div>";
  return "<table><thead><tr>" + cols.map((c) => "<th>" + c[0] + "</th>").join("") + "</tr></thead><tbody>" +
    rows.map((row) => "<tr>" + cols.map((c) => "<td>" + c[1](row) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
}
const score = (s) => '<span class="bar"><i style="width:' + s.score + '%"></i></span>' + s.score;
const why = (s) => '<details><summary>' + esc(s.setup.replace("_", " ")) + "</summary>" +
  s.factors.map((f) => (f.points === f.max ? "✅ " : f.points > 0 ? "➖ " : "❌ ") + esc(f.label)).join("<br>") + "</details>";

function equityChart(points) {
  if (points.length < 2) return '<div class="empty">No closed trades yet.</div>';
  const W = 800, H = 220, P = 36;
  const xs = points.map((p) => p.time), ys = points.map((p) => p.balance);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (x) => P + ((x - x0) / (x1 - x0 || 1)) * (W - P - 8);
  const sy = (y) => 8 + (1 - (y - y0) / (y1 - y0 || 1)) * (H - 30);
  const d = points.map((p, i) => (i ? "L" : "M") + sx(p.time).toFixed(1) + " " + sy(p.balance).toFixed(1)).join(" ");
  const up = ys[ys.length - 1] >= ys[0];
  const color = up ? "var(--up)" : "var(--down)";
  const ticks = [y0, (y0 + y1) / 2, y1].map((v) =>
    '<text x="0" y="' + (sy(v) + 4) + '" font-size="11" fill="var(--muted)">' + Math.round(v).toLocaleString() + "</text>" +
    '<line x1="' + P + '" x2="' + W + '" y1="' + sy(v) + '" y2="' + sy(v) + '" stroke="var(--line)"/>').join("");
  return '<svg viewBox="0 0 ' + W + " " + H + '">' + ticks +
    '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
    '<text x="' + P + '" y="' + (H - 4) + '" font-size="11" fill="var(--muted)">' + t(x0) + "</text>" +
    '<text x="' + W + '" y="' + (H - 4) + '" font-size="11" fill="var(--muted)" text-anchor="end">' + t(x1) + "</text></svg>";
}

function statsRow(label, s) {
  return "<tr><td>" + esc(label) + "</td><td>" + s.trades + "</td><td>" + (s.winRate * 100).toFixed(1) + "%</td><td class=" + cls(s.totalR) + ">" + r(s.totalR) +
    "</td><td class=" + cls(s.avgR) + ">" + r(s.avgR) + "</td><td>" + s.profitFactor.toFixed(2) + "</td><td>" + s.maxDrawdownR.toFixed(1) + "R</td></tr>";
}

function render(data) {
  const { state: st, backtest: bt, news, now } = data;
  paused = st.paused;
  $("demo").hidden = !st.demo;
  $("dot").className = "dot" + (paused ? " paused" : "");
  $("statusText").textContent = (paused ? "Paused" : "Running") + " · last scan " + (st.lastScan ? Math.round((now - st.lastScan) / 60000) + " min ago" : "never") + (data.settings.telegram ? " · Telegram on" : "");
  $("toggle").textContent = paused ? "Resume" : "Pause";
  const urls = data.settings.lanUrls || [];
  $("lan").hidden = !urls.length;
  if (urls.length) $("lan").innerHTML = "📱 On your phone (same Wi-Fi) open: " + urls.map((u) => "<b>" + esc(u) + "</b>").join(" or ") + ". Then use the browser menu → <b>Add to Home Screen</b>.";
  checkAlerts(st);

  const closed = st.closed;
  const wins = closed.filter((x) => x.result.r > 0).length;
  const gp = closed.filter((x) => x.result.r > 0).reduce((a, x) => a + x.result.r, 0);
  const gl = -closed.filter((x) => x.result.r < 0).reduce((a, x) => a + x.result.r, 0);
  const day = Math.floor(now / 864e5);
  const today = closed.filter((x) => Math.floor((x.result.exitTime || 0) / 864e5) === day).reduce((a, x) => a + x.pnlUSD, 0);
  const floating = st.open.reduce((a, x) => a + x.pnlUSD, 0);
  const pnl = st.balance - st.startingBalance;
  const kpi = (label, value, sub, c) => '<div class="card kpi"><div class="label">' + label + '</div><div class="value ' + (c || "") + '">' + value + '</div><div class="sub">' + (sub || "&nbsp;") + "</div></div>";
  $("kpis").innerHTML =
    kpi("Balance", usd(st.balance), '<span class="' + cls(pnl) + '">' + usd(pnl) + " (" + (pnl / st.startingBalance * 100).toFixed(1) + "%)</span>") +
    kpi("Today", usd(today), "floating " + usd(floating), cls(today)) +
    kpi("Win rate", closed.length ? (wins / closed.length * 100).toFixed(1) + "%" : "–", closed.length + " closed trades") +
    kpi("Profit factor", gl ? (gp / gl).toFixed(2) : "–", "above 1.00 = profitable") +
    kpi("Open trades", st.open.length + " / " + data.settings.risk.maxOpenTrades, data.settings.risk.riskPercent + "% risk per trade");

  $("equity").innerHTML = equityChart(st.equity);
  $("news").innerHTML = news.length ? "<table><tbody>" + news.map((n) => "<tr><td>" + t(n.time) + '</td><td><span class="chip">' + esc(n.currency) + "</span></td><td>" + esc(n.title) + "</td></tr>").join("") + "</tbody></table>"
    : '<div class="empty">No high-impact news loaded.</div>';

  $("open").innerHTML = table(st.open.slice().reverse(), [
    ["Opened", (x) => t(x.candleTime + 3e5)], ["Pair", (x) => x.symbol], ["Side", (x) => '<span class="side ' + x.side + '">' + x.side + "</span>"],
    ["Lots", (x) => x.lots.toFixed(2)], ["Entry", (x) => px(x.symbol, x.entry)], ["SL", (x) => px(x.symbol, x.result.tp1Hit ? x.entry : x.stopLoss)],
    ["TP1", (x) => px(x.symbol, x.tp1) + (x.result.tp1Hit ? " ✅" : "")], ["TP2", (x) => px(x.symbol, x.tp2)],
    ["Floating", (x) => '<span class="' + cls(x.pnlUSD) + '">' + usd(x.pnlUSD) + " (" + r(x.result.r) + ")</span>"],
  ], "No open trades.");

  $("signals").innerHTML = table(st.signals.slice(-30).reverse(), [
    ["Time (UTC)", (x) => t(x.candleTime + 3e5)], ["Pair", (x) => x.symbol], ["Side", (x) => '<span class="side ' + x.side + '">' + x.side + "</span>"],
    ["Strength", score], ["Setup", why], ["Entry", (x) => px(x.symbol, x.entry)], ["SL", (x) => px(x.symbol, x.stopLoss)],
    ["TP1", (x) => px(x.symbol, x.tp1)], ["TP2", (x) => px(x.symbol, x.tp2)],
    ["Status", (x) => x.status === "OPENED" ? '<span class="chip pos">opened ' + (x.lots != null ? x.lots.toFixed(2) + " lot" : "") + "</span>" : '<span class="chip">skipped: ' + esc(x.reason || "") + "</span>"],
  ], "No signals yet. Signals appear after a 5m candle closes with all conditions met.");

  $("closed").innerHTML = table(closed.slice(-40).reverse(), [
    ["Closed", (x) => t(x.result.exitTime)], ["Pair", (x) => x.symbol], ["Side", (x) => '<span class="side ' + x.side + '">' + x.side + "</span>"],
    ["Setup", (x) => x.setup.replace("_", " ")], ["Score", (x) => x.score], ["Lots", (x) => x.lots.toFixed(2)],
    ["Result", (x) => '<span class="chip">' + x.result.outcome + "</span>"],
    ["R", (x) => '<span class="' + cls(x.result.r) + '">' + r(x.result.r) + "</span>"], ["P&L", (x) => '<span class="' + cls(x.pnlUSD) + '">' + usd(x.pnlUSD) + "</span>"],
  ], "No closed trades yet.");

  if (!bt) { $("backtest").innerHTML = '<div class="empty">Run <code>npm run backtest</code> to see results here.</div>'; return; }
  const head = "<table><thead><tr><th></th><th>Trades</th><th>Win</th><th>Total</th><th>Avg</th><th>PF</th><th>Max DD</th></tr></thead><tbody>";
  $("backtest").innerHTML = '<p class="muted" style="margin-top:0">' + new Date(bt.from).toISOString().slice(0, 10) + " → " + new Date(bt.to).toISOString().slice(0, 10) +
    " · $" + bt.risk.startingBalance.toLocaleString() + " → " + usd(bt.finalBalance) + " at " + bt.risk.riskPercent + "% risk. Trust out-of-sample more than in-sample.</p>" +
    '<div class="scroll">' + head + statsRow("In-sample (first 70%)", bt.inSample) + statsRow("Out-of-sample (last 30%)", bt.outOfSample) + statsRow("All", bt.overall) +
    bt.bySetup.map((g) => statsRow(g.key.replace("_", " "), g.stats)).join("") +
    bt.byScore.map((g) => statsRow("Score " + g.key, g.stats)).join("") +
    bt.bySymbol.map((g) => statsRow(g.key, g.stats)).join("") + "</tbody></table></div>";
}

async function refresh() {
  try { render(await (await fetch("/api/state")).json()); }
  catch (e) { $("statusText").textContent = "Bot not reachable"; }
}
$("toggle").onclick = async () => { await fetch(paused ? "/api/resume" : "/api/pause", { method: "POST" }); refresh(); };
refresh();
setInterval(refresh, 15000);
</script>
</body>
</html>`;
