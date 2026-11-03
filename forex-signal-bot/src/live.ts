import { existsSync, readFileSync } from "node:fs";
import { DASHBOARD_PORT, FIVE_MIN, SYMBOLS, symbolConfig } from "./config.ts";
import { loadAll } from "./data.ts";
import { startDashboard } from "./dashboard.ts";
import { dashboardHost, lanUrls } from "./lan.ts";
import { blockingNews, highImpactNews, type NewsEvent } from "./news.ts";
import { loadState, saveState, strategySummary, todayR, tryOpen, updateOpenTrades } from "./paper.ts";
import type { PriceMap } from "./risk.ts";
import { findSignals } from "./strategy.ts";
import { formatClose, formatSignal, pollCommands, sendTelegram, telegramEnabled } from "./telegram.ts";
import type { Report } from "./backtest.ts";

const STATE_FILE = new URL("../data/paper.json", import.meta.url);
const BACKTEST_FILE = new URL("../data/backtest.json", import.meta.url);

const state = loadState(STATE_FILE);
let news: NewsEvent[] = [];

function readBacktest(): Report | null {
  return existsSync(BACKTEST_FILE) ? (JSON.parse(readFileSync(BACKTEST_FILE, "utf8")) as Report) : null;
}

async function scan() {
  const data = await loadAll(SYMBOLS, "5d", "1mo");
  const prices: PriceMap = Object.fromEntries(data.map((d) => [d.cfg.name, d.c5[d.c5.length - 1].close]));

  for (const t of updateOpenTrades(state, data)) {
    console.log(formatClose(t));
    await sendTelegram(formatClose(t));
  }

  news = await highImpactNews();
  const seen = new Set(state.signals.map((s) => s.id));
  let found = 0;
  for (const d of data) {
    const last = d.c5.length - 1;
    // Skip stale data (market closed, weekend, feed delay).
    if (Date.now() - (d.c5[last].time + FIVE_MIN) > 3 * FIVE_MIN) continue;
    const sig = findSignals(d.cfg.name, d.c5, d.c30).get(last);
    if (!sig || seen.has(sig.id)) continue;
    found++;
    const cfg = symbolConfig(sig.symbol);
    const event = blockingNews(news, [cfg.base, cfg.quote], Date.now());
    const log = tryOpen(state, sig, prices, event ? `news: ${event.currency} ${event.title}` : undefined);
    if (log.status === "OPENED") {
      const text = formatSignal(sig, log.lots);
      console.log("\n" + text + "\n");
      await sendTelegram(text);
    } else {
      console.log(`Skipped ${sig.side} ${sig.symbol} (score ${sig.score}): ${log.reason}`);
    }
  }
  state.lastScan = Date.now();
  saveState(state, STATE_FILE);
  const stamp = new Date().toISOString().slice(11, 16);
  console.log(`[${stamp} UTC] ${data.length} pairs scanned, ${found} new signal(s), ${state.open.length} open, balance $${state.balance.toFixed(2)}`);
}

function command(cmd: string): string {
  const closed = state.closed;
  const wins = closed.filter((t) => t.result.r > 0).length;
  const totalR = closed.reduce((s, t) => s + t.result.r, 0);
  switch (cmd) {
    case "/status":
      return [
        `${state.paused ? "⏸ Paused" : "▶️ Running"}`,
        `Balance: $${state.balance.toFixed(2)}`,
        `Today: ${todayR(state).toFixed(2)}R`,
        `Open trades: ${state.open.length}`,
        `Last scan: ${state.lastScan ? new Date(state.lastScan).toISOString().slice(11, 16) + " UTC" : "never"}`,
        `Settings: ${strategySummary()}`,
      ].join("\n");
    case "/stats":
      return closed.length
        ? `${closed.length} closed trades\nWin rate: ${((wins / closed.length) * 100).toFixed(1)}%\nTotal: ${totalR.toFixed(2)}R\nAvg: ${(totalR / closed.length).toFixed(3)}R per trade\nP&L: $${(state.balance - state.startingBalance).toFixed(2)}`
        : "No closed trades yet.";
    case "/open":
      return state.open.length
        ? state.open.map((t) => `${t.side} ${t.symbol} ${t.lots} lot, ${t.result.r >= 0 ? "+" : ""}${t.result.r.toFixed(2)}R${t.result.tp1Hit ? " (TP1 hit)" : ""}`).join("\n")
        : "No open trades.";
    case "/pause":
      state.paused = true;
      saveState(state, STATE_FILE);
      return "⏸ Paused. No new trades will be opened. Open trades are still tracked.";
    case "/resume":
      state.paused = false;
      saveState(state, STATE_FILE);
      return "▶️ Resumed.";
    default:
      return "Commands: /status /stats /open /pause /resume";
  }
}

async function main() {
  if (process.argv.includes("--once")) return scan();

  const host = dashboardHost();
  const urls = lanUrls(host, DASHBOARD_PORT);
  const server = await startDashboard(
    {
      state: () => state,
      backtest: readBacktest,
      news: () => news,
      setPaused: (p) => {
        state.paused = p;
        saveState(state, STATE_FILE);
      },
      telegram: telegramEnabled(),
      lanUrls: urls,
    },
    DASHBOARD_PORT,
    host,
  );
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : DASHBOARD_PORT;
  console.log(`Dashboard: http://localhost:${port}`);
  if (urls.length) console.log(`On your phone (same Wi-Fi): ${urls.join("  or  ")}`);
  else console.log("Add --lan to open the dashboard from your phone on the same Wi-Fi.");
  console.log(telegramEnabled() ? "Telegram alerts + commands on." : "Telegram not configured - alerts go to console and dashboard only.");
  console.log(`Strategy: ${strategySummary()}`);
  void pollCommands(command);

  for (;;) {
    try {
      await scan();
    } catch (err) {
      console.error(`Scan failed: ${(err as Error).message}`);
    }
    // Wait until 20s after the next 5-minute boundary so the candle has closed on the feed.
    const wait = FIVE_MIN - (Date.now() % FIVE_MIN) + 20_000;
    await new Promise((r) => setTimeout(r, wait));
  }
}

await main();
