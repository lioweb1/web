/** Human-readable time in the workspace time zone, e.g. "Mon 2 Nov, 09:00". */
export function fmtSlot(date: Date, tz: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  } catch {
    return date.toISOString();
  }
}

const PLATFORM_NAMES: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", threads: "Threads", bluesky: "Bluesky", mastodon: "Mastodon", telegram: "Telegram", discord: "Discord", linkedin: "LinkedIn" };
export const platformName = (id: string) => PLATFORM_NAMES[id] ?? id;
