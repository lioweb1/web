/** Posting-slot maths in the workspace's time zone, without a date library. */

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parseTimes(times: string[]) {
  return [...new Set(times.map((t) => t.trim()).filter((t) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t)).map((t) => t.padStart(5, "0")))].sort();
}

/** Wall-clock parts of `date` in `tz`. */
export function zonedParts(date: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
}

function offsetMs(date: Date, tz: string) {
  const p = zonedParts(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `tz` reads the given local time. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let t = guess - offsetMs(new Date(guess), tz);
  // A second pass settles DST transitions.
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

/** Parse a `datetime-local` value ("2026-11-02T09:30") as wall-clock time in `tz`. */
export function parseLocalDateTime(value: string, tz: string) {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return zonedTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

/** Format an instant for a `datetime-local` input in `tz`. */
export function toLocalInput(date: Date, tz: string) {
  const p = zonedParts(date, tz);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}

/**
 * Next posting slot after `after` that is at least `gapMinutes` away from every already taken
 * time. Without posting times, returns `after` (publish immediately).
 */
export function nextSlot(times: string[], tz: string, after: Date, taken: Date[], gapMinutes = 30): Date {
  const slots = parseTimes(times);
  if (!slots.length || !isValidTimeZone(tz)) return after;
  const start = zonedParts(after, tz);
  for (let d = 0; d < 60; d++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + d));
    for (const s of slots) {
      const [h, m] = s.split(":").map(Number);
      const at = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, m, tz);
      if (at.getTime() <= after.getTime() + 60_000) continue;
      if (taken.some((t) => Math.abs(t.getTime() - at.getTime()) < gapMinutes * 60_000)) continue;
      return at;
    }
  }
  return after;
}
