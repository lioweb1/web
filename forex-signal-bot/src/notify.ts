import type { SymbolConfig } from "./config.ts";
import type { Signal } from "./types.ts";

export function formatSignal(s: Signal, cfg: SymbolConfig): string {
  const p = (v: number) => v.toFixed(cfg.digits);
  const time = new Date(s.candleTime + 5 * 60_000).toISOString().replace("T", " ").slice(0, 16);
  return [
    `${s.side === "BUY" ? "🟢" : "🔴"} ${s.side} ${s.symbol}  (${time} UTC, 5m close)`,
    `Entry: ${p(s.entry)}`,
    `Stop Loss: ${p(s.stopLoss)}`,
    `Take Profit: ${p(s.takeProfit)}  (1.5R)`,
    `Why:`,
    ...s.reasons.map((r) => `  • ${r}`),
    `Not financial advice. Check the backtest before risking money.`,
  ].join("\n");
}

/** Sends to Telegram when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set; otherwise does nothing. */
export async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) console.error(`Telegram error ${res.status}: ${await res.text()}`);
}
