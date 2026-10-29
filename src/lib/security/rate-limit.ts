import { sql } from "drizzle-orm";
import { systemDb } from "@/lib/db";

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Too many requests. Try again in ${retryAfterSeconds}s.`);
  }
}

/**
 * Fixed-window counter stored in PostgreSQL, so limits hold across multiple
 * app instances. Returns remaining requests or throws RateLimitError.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<number> {
  const res = await systemDb().execute<{ count: number; window_start: Date }>(sql`
    insert into rate_limits (key, count, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count, window_start
  `);
  const row = res.rows[0];
  if (row.count > limit) {
    const elapsed = (Date.now() - new Date(row.window_start).getTime()) / 1000;
    throw new RateLimitError(Math.max(1, Math.ceil(windowSeconds - elapsed)));
  }
  return limit - row.count;
}
