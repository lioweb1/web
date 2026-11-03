import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { FIVE_MIN, SYMBOLS } from "./config.ts";
import { fetchCandles } from "./data.ts";
import { formatSignal, sendTelegram } from "./notify.ts";
import { findSignals } from "./strategy.ts";
import type { Signal } from "./types.ts";

const LOG = new URL("../signals.jsonl", import.meta.url);

function loadSent(): Set<string> {
  const sent = new Set<string>();
  if (!existsSync(LOG)) return sent;
  for (const line of readFileSync(LOG, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const s = JSON.parse(line) as Signal;
    sent.add(`${s.symbol}:${s.candleTime}`);
  }
  return sent;
}

async function scan(sent: Set<string>) {
  const stamp = new Date().toISOString().slice(11, 16);
  let found = 0;
  for (const cfg of SYMBOLS) {
    try {
      const [c5, c30] = await Promise.all([
        fetchCandles(cfg.yahoo, "5m", "5d"),
        fetchCandles(cfg.yahoo, "30m", "1mo"),
      ]);
      const last = c5.length - 1;
      if (last < 0) continue;
      // Skip stale data (market closed / weekend).
      if (Date.now() - (c5[last].time + FIVE_MIN) > 3 * FIVE_MIN) continue;
      const sig = findSignals(cfg.name, c5, c30).get(last);
      if (!sig) continue;
      const key = `${sig.symbol}:${sig.candleTime}`;
      if (sent.has(key)) continue;
      sent.add(key);
      appendFileSync(LOG, JSON.stringify(sig) + "\n");
      const text = formatSignal(sig, cfg);
      console.log("\n" + text + "\n");
      await sendTelegram(text);
      found++;
    } catch (err) {
      console.error(`${cfg.name}: ${(err as Error).message}`);
    }
  }
  console.log(`[${stamp} UTC] scanned ${SYMBOLS.length} pairs, ${found} new signal(s)`);
}

async function main() {
  const sent = loadSent();
  if (process.argv.includes("--once")) return scan(sent);
  console.log("Live mode: scanning shortly after every 5m candle close. Ctrl+C to stop.");
  if (!process.env.TELEGRAM_BOT_TOKEN) console.log("(Telegram not configured - printing to console only.)");
  for (;;) {
    await scan(sent);
    // Wait until 20s after the next 5-minute boundary so the candle has closed on the feed.
    const wait = FIVE_MIN - (Date.now() % FIVE_MIN) + 20_000;
    await new Promise((r) => setTimeout(r, wait));
  }
}

await main();
