import { sql } from "drizzle-orm";
import { systemDb, schema } from "@/lib/db";

export type Plan = "free" | "pro" | "agency";
export type LimitKey = "savedLeads" | "discoveryRunsPerMonth" | "exportRowsPerMonth" | "monitoringRules" | "websiteAnalysesPerMonth" | "members";

/**
 * Plan limits. All data sources used are free, so these limits exist to protect
 * public providers' fair-use policies and your server, not to sell anything.
 * Per-workspace overrides live in workspaces.limit_overrides (editable in Settings).
 * A value of -1 means no app-level limit.
 */
export const PLAN_LIMITS: Record<Plan, Record<LimitKey, number>> = {
  free: { savedLeads: 2000, discoveryRunsPerMonth: 300, exportRowsPerMonth: 10000, monitoringRules: 10, websiteAnalysesPerMonth: 1500, members: 3 },
  pro: { savedLeads: 25000, discoveryRunsPerMonth: 3000, exportRowsPerMonth: 100000, monitoringRules: 50, websiteAnalysesPerMonth: 15000, members: 10 },
  agency: { savedLeads: -1, discoveryRunsPerMonth: -1, exportRowsPerMonth: -1, monitoringRules: -1, websiteAnalysesPerMonth: -1, members: -1 },
};

export const PLAN_FEATURES: Record<Plan, string[]> = {
  free: ["Lead discovery from all free sources", "Website & domain intelligence", "Monitoring rules", "CSV export", "In-app, browser & email alerts"],
  pro: ["Everything in Free", "Higher limits", "More monitoring rules"],
  agency: ["Everything in Pro", "No app-level limits", "Larger teams"],
};

export const LIMIT_LABELS: Record<LimitKey, string> = {
  savedLeads: "Saved leads",
  discoveryRunsPerMonth: "Discovery runs / month",
  exportRowsPerMonth: "Exported rows / month",
  monitoringRules: "Monitoring rules",
  websiteAnalysesPerMonth: "Website analyses / month",
  members: "Workspace members",
};

export class LimitExceededError extends Error {
  constructor(public key: LimitKey, public limit: number) {
    super(`${LIMIT_LABELS[key]} limit reached (${limit}). Adjust limits in Settings → Usage & plan.`);
  }
}

export function currentPeriod(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

export async function getLimits(workspaceId: string): Promise<Record<LimitKey, number>> {
  const [ws] = await systemDb()
    .select({ plan: schema.workspaces.plan, overrides: schema.workspaces.limitOverrides })
    .from(schema.workspaces)
    .where(sql`${schema.workspaces.id} = ${workspaceId}`);
  if (!ws) throw new Error("Workspace not found");
  return { ...PLAN_LIMITS[ws.plan], ...(ws.overrides as Partial<Record<LimitKey, number>>) };
}

export async function getUsage(workspaceId: string, period = currentPeriod()): Promise<Record<string, number>> {
  const rows = await systemDb()
    .select()
    .from(schema.usageRecords)
    .where(sql`${schema.usageRecords.workspaceId} = ${workspaceId} and ${schema.usageRecords.period} = ${period}`);
  return Object.fromEntries(rows.map((r) => [r.metric, r.quantity]));
}

/** Atomically consume `qty` units of a monthly metered limit, or throw. */
export async function consumeUsage(workspaceId: string, key: LimitKey, qty = 1) {
  const limits = await getLimits(workspaceId);
  const limit = limits[key];
  const period = currentPeriod();
  if (limit >= 0 && qty > limit) throw new LimitExceededError(key, limit);
  const res = await systemDb().execute<{ quantity: number }>(sql`
    insert into usage_records (workspace_id, metric, period, quantity) values (${workspaceId}, ${key}, ${period}, ${qty})
    on conflict (workspace_id, metric, period) do update set quantity = usage_records.quantity + ${qty}, updated_at = now()
      where ${limit} < 0 or usage_records.quantity + ${qty} <= ${limit}
    returning quantity
  `);
  if (res.rows.length === 0) throw new LimitExceededError(key, limit);
}

/** Non-metered limits (counts of existing rows). */
export async function assertCountBelow(workspaceId: string, key: LimitKey, current: number, adding = 1) {
  const limit = (await getLimits(workspaceId))[key];
  if (limit >= 0 && current + adding > limit) throw new LimitExceededError(key, limit);
}
