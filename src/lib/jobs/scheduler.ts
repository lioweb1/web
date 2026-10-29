import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { schema, systemDb } from "@/lib/db";
import { enqueue, recoverStaleJobs } from "./queue";
import { getLimits, getUsage, LIMIT_LABELS, type LimitKey } from "@/lib/plans";
import { notify } from "@/lib/notifications/notify";
import { emailDeliveryAvailable } from "@/lib/notifications/email";
import { getProvider } from "@/lib/providers/registry";

type Rule = typeof schema.monitoringRules.$inferSelect;

export function intervalMinutes(rule: Pick<Rule, "frequency" | "customIntervalMinutes" | "providerIds">): number | null {
  const base = { manual: null, hourly: 60, daily: 1440, weekly: 10080, custom: Math.max(15, rule.customIntervalMinutes ?? 1440) }[rule.frequency];
  if (base === null) return null;
  // Never schedule faster than any selected provider's permitted refresh interval.
  const min = Math.max(0, ...rule.providerIds.map((p) => getProvider(p)?.minIntervalMinutes ?? 0));
  return Math.max(base, min);
}

export function nextRunAt(rule: Pick<Rule, "frequency" | "customIntervalMinutes" | "providerIds">, from = new Date()): Date | null {
  const m = intervalMinutes(rule);
  return m === null ? null : new Date(from.getTime() + m * 60_000);
}

/** Enqueue one discovery job per provider of a rule. Idempotent per scheduled slot. */
export async function enqueueRuleRun(rule: Rule, slot: string, opts: { manual?: boolean } = {}) {
  const jobs = [];
  for (const providerId of rule.providerIds) {
    const since = !opts.manual && rule.lastSuccessAt ? rule.lastSuccessAt.toISOString() : undefined;
    const j = await enqueue({
      type: "discovery_run",
      workspaceId: rule.workspaceId,
      payload: { providerId, criteria: rule.criteria, ruleId: rule.id, since },
      idempotencyKey: `rule:${rule.id}:${providerId}:${slot}`,
    });
    if (j) jobs.push(j);
  }
  return jobs;
}

/** One scheduler pass. Safe to run concurrently (idempotency keys + conditional updates). */
export async function schedulerTick(now = new Date()) {
  const db = systemDb();
  const stats = { recovered: 0, rulesQueued: 0, digests: 0, quotaWarnings: 0 };
  stats.recovered = await recoverStaleJobs();

  const due = await db
    .select()
    .from(schema.monitoringRules)
    .where(and(eq(schema.monitoringRules.active, true), isNotNull(schema.monitoringRules.nextRunAt), lte(schema.monitoringRules.nextRunAt, now)))
    .limit(200);
  for (const rule of due) {
    // Claim the slot: only the pass that moves next_run_at enqueues.
    const next = nextRunAt(rule, now);
    const claimed = await db
      .update(schema.monitoringRules)
      .set({ nextRunAt: next })
      .where(and(eq(schema.monitoringRules.id, rule.id), eq(schema.monitoringRules.nextRunAt, rule.nextRunAt!)))
      .returning({ id: schema.monitoringRules.id });
    if (!claimed.length) continue;
    await enqueueRuleRun(rule, rule.nextRunAt!.toISOString());
    stats.rulesQueued++;
  }

  // Hourly reminder sweep.
  await enqueue({ type: "task_reminders", workspaceId: null, idempotencyKey: `reminders:${now.toISOString().slice(0, 13)}` });

  // Daily digests.
  if (emailDeliveryAvailable()) {
    const prefs = await db
      .select()
      .from(schema.notificationPrefs)
      .where(and(sql`${schema.notificationPrefs.prefs}->>'email' = 'daily'`, sql`(${schema.notificationPrefs.lastDigestAt} is null or ${schema.notificationPrefs.lastDigestAt} < ${new Date(now.getTime() - 23 * 3600_000)})`));
    for (const p of prefs) {
      const j = await enqueue({ type: "send_digest", workspaceId: p.workspaceId, payload: { userId: p.userId }, idempotencyKey: `digest:${p.workspaceId}:${p.userId}:${now.toISOString().slice(0, 10)}` });
      if (j) stats.digests++;
    }
  }

  // Usage warnings at 80% of monthly limits (once per metric per month).
  if (now.getMinutes() < 5 || process.env.NODE_ENV === "test") {
    const wss = await db.select({ id: schema.workspaces.id }).from(schema.workspaces);
    for (const ws of wss) {
      const [limits, usage] = await Promise.all([getLimits(ws.id), getUsage(ws.id)]);
      for (const [key, used] of Object.entries(usage)) {
        const limit = limits[key as LimitKey];
        if (limit > 0 && used >= limit * 0.8) {
          const n = await notify(ws.id, { type: "quota_warning", title: `${LIMIT_LABELS[key as LimitKey]}: ${used} of ${limit} used this month`, body: "Raise the limit in Settings → Usage & plan, or reduce monitoring frequency.", dedupeKey: `quota:${key}:${now.toISOString().slice(0, 7)}` });
          if (n) stats.quotaWarnings++;
        }
      }
      // Provider quota warnings (when the provider reports remaining quota).
      const ints = await db.select().from(schema.integrations).where(and(eq(schema.integrations.workspaceId, ws.id), isNotNull(schema.integrations.remainingQuota), lte(schema.integrations.remainingQuota, 50)));
      for (const i of ints) await notify(ws.id, { type: "quota_warning", title: `${getProvider(i.providerId)?.name ?? i.providerId} API quota low (${i.remainingQuota} remaining)`, dedupeKey: `pquota:${i.providerId}:${now.toISOString().slice(0, 13)}` });
    }
  }
  return stats;
}
