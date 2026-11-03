import { db, tx } from "./db";
import { FIRM_MONTHLY_CREDITS, MAX_CONCURRENT_ANALYSES, planSpend, type Spend } from "./plans";

export class CreditError extends Error {
  constructor(message: string, public status: number, public code: "payment_required" | "busy") {
    super(message);
  }
}

export type Reservation = { eventId: number; spend: Spend };

/**
 * Atomically takes the credits for a case and records a 'running' usage event.
 * The org row is locked so two uploads can't spend the same credit.
 */
export async function reserveCredits(orgId: string, userId: string, pages: number, files: number): Promise<Reservation> {
  return tx(async (c) => {
    const { rows } = await c.query("select trial_credits, plan_credits, purchased_credits from orgs where id = $1 for update", [orgId]);
    if (!rows[0]) throw new CreditError("Account not found.", 404, "payment_required");
    const running = await c.query(
      "select count(*)::int as n from usage_events where org_id = $1 and kind = 'analysis' and status = 'running' and created_at > now() - interval '30 minutes'",
      [orgId],
    );
    if (running.rows[0].n >= MAX_CONCURRENT_ANALYSES) {
      throw new CreditError(`Your account already has ${MAX_CONCURRENT_ANALYSES} cases processing. Wait for one to finish.`, 429, "busy");
    }
    const r = planSpend({ trial: rows[0].trial_credits, plan: rows[0].plan_credits, purchased: rows[0].purchased_credits }, pages);
    if (!r.ok) throw new CreditError(r.reason, 402, "payment_required");
    const s = r.spend;
    await c.query(
      "update orgs set trial_credits = trial_credits - $2, plan_credits = plan_credits - $3, purchased_credits = purchased_credits - $4 where id = $1",
      [orgId, s.trial, s.plan, s.purchased],
    );
    const ev = await c.query(
      `insert into usage_events (org_id, user_id, kind, status, credits, trial_used, plan_used, purchased_used, pages, files)
       values ($1, $2, 'analysis', 'running', $3, $4, $5, $6, $7, $8) returning id`,
      [orgId, userId, -s.credits, s.trial, s.plan, s.purchased, pages, files],
    );
    return { eventId: Number(ev.rows[0].id), spend: s };
  });
}

export async function finishReservation(eventId: number): Promise<void> {
  await (await db()).query("update usage_events set status = 'done', finished_at = now() where id = $1 and status = 'running'", [eventId]);
}

/** Gives the credits back when a case produced nothing usable. Idempotent. */
export async function refundReservation(eventId: number, note: string): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query("update usage_events set status = 'refunded', finished_at = now(), note = $2 where id = $1 and status = 'running' returning *", [eventId, note.slice(0, 300)]);
    const e = rows[0];
    if (!e) return;
    await c.query(
      "update orgs set trial_credits = trial_credits + $2, plan_credits = plan_credits + $3, purchased_credits = purchased_credits + $4 where id = $1",
      [e.org_id, e.trial_used, e.plan_used, e.purchased_used],
    );
  });
}

export async function addPurchasedCredits(orgId: string, credits: number, note: string): Promise<void> {
  await tx(async (c) => {
    await c.query("update orgs set purchased_credits = purchased_credits + $2 where id = $1", [orgId, credits]);
    await c.query("insert into usage_events (org_id, kind, credits, note) values ($1, 'purchase', $2, $3)", [orgId, credits, note]);
  });
}

/** Called on every paid subscription invoice: monthly credits reset (no rollover). */
export async function renewPlanCredits(orgId: string, periodEnd: Date | null, note: string): Promise<void> {
  await tx(async (c) => {
    await c.query(
      "update orgs set plan = 'firm', subscription_status = 'active', plan_credits = $2, current_period_end = coalesce($3, current_period_end) where id = $1",
      [orgId, FIRM_MONTHLY_CREDITS, periodEnd],
    );
    await c.query("insert into usage_events (org_id, kind, credits, note) values ($1, 'plan_renewal', $2, $3)", [orgId, FIRM_MONTHLY_CREDITS, note]);
  });
}

export async function recentUsage(orgId: string, limit = 25) {
  const { rows } = await (await db()).query(
    `select e.id, e.kind, e.status, e.credits, e.pages, e.files, e.note, e.created_at, u.name as user_name
       from usage_events e left join users u on u.id = e.user_id
      where e.org_id = $1 order by e.created_at desc, e.id desc limit $2`,
    [orgId, limit],
  );
  return rows as { id: string; kind: string; status: string; credits: number; pages: number | null; files: number | null; note: string | null; created_at: Date; user_name: string | null }[];
}
