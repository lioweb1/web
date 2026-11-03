import { symbolConfig } from "./config.ts";
import type { PaperTrade } from "./paper.ts";
import type { Signal } from "./types.ts";

const token = () => process.env.TELEGRAM_BOT_TOKEN;
const chatId = () => process.env.TELEGRAM_CHAT_ID;
export const telegramEnabled = () => Boolean(token() && chatId());

export function formatSignal(s: Signal, lots?: number): string {
  const cfg = symbolConfig(s.symbol);
  const p = (v: number) => v.toFixed(cfg.digits);
  const time = new Date(s.candleTime + 5 * 60_000).toISOString().replace("T", " ").slice(0, 16);
  const lines = [
    `${s.side === "BUY" ? "🟢" : "🔴"} ${s.side} ${s.symbol} - ${s.setup.replace("_", " ")}`,
    `Strength: ${s.score}/100   (${time} UTC)`,
    "",
    `Entry: ${p(s.entry)}`,
    `Stop Loss: ${p(s.stopLoss)}`,
    `TP1: ${p(s.tp1)}  (close half, SL -> entry)`,
    `TP2: ${p(s.tp2)}`,
  ];
  if (lots != null) lines.push(`Lot size: ${lots.toFixed(2)}`);
  lines.push("", ...s.factors.map((f) => `${f.points === f.max ? "✅" : f.points > 0 ? "➖" : "❌"} ${f.label}`));
  lines.push("", "Score is signal quality, not win probability. Not financial advice.");
  return lines.join("\n");
}

export function formatClose(t: PaperTrade): string {
  const icon = t.result.r > 0 ? "✅" : t.result.r < 0 ? "❌" : "⚪";
  const sign = t.result.r >= 0 ? "+" : "";
  return `${icon} ${t.symbol} ${t.side} closed: ${t.result.outcome}  ${sign}${t.result.r.toFixed(2)}R  ($${t.pnlUSD.toFixed(2)})`;
}

export async function sendTelegram(text: string): Promise<void> {
  if (!telegramEnabled()) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId(), text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error(`Telegram error ${res.status}: ${await res.text()}`);
  } catch (err) {
    console.error(`Telegram send failed: ${(err as Error).message}`);
  }
}

/**
 * Long-polls Telegram for commands. Only messages from TELEGRAM_CHAT_ID are answered, so
 * nobody else can pause or query your bot.
 */
export async function pollCommands(handle: (command: string) => string | Promise<string>): Promise<void> {
  if (!telegramEnabled()) return;
  let offset = 0;
  for (;;) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token()}/getUpdates?timeout=30&offset=${offset}`, {
        signal: AbortSignal.timeout(40_000),
      });
      const json = (await res.json()) as {
        result?: Array<{ update_id: number; message?: { chat: { id: number }; text?: string } }>;
      };
      for (const u of json.result ?? []) {
        offset = u.update_id + 1;
        const text = u.message?.text?.trim();
        if (!text || String(u.message!.chat.id) !== String(chatId())) continue;
        await sendTelegram(await handle(text.split(/[\s@]/)[0].toLowerCase()));
      }
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
