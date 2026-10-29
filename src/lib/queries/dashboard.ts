import { and, desc, eq, sql } from "drizzle-orm";
import { schema, systemDb, withTenant } from "@/lib/db";

export async function getTargetMarkets(ws: string) {
  return withTenant(ws, (tx) => tx.select().from(schema.targetMarkets).where(eq(schema.targetMarkets.workspaceId, ws)).orderBy(schema.targetMarkets.createdAt));
}

export async function getDashboardSide(ws: string, userId: string) {
  return withTenant(ws, async (tx) => {
    const [notifications, rules, integrations, counts] = await Promise.all([
      tx.select().from(schema.notifications).where(and(eq(schema.notifications.workspaceId, ws), eq(schema.notifications.userId, userId))).orderBy(desc(schema.notifications.createdAt)).limit(6),
      tx.select().from(schema.monitoringRules).where(eq(schema.monitoringRules.workspaceId, ws)).orderBy(desc(schema.monitoringRules.updatedAt)).limit(6),
      tx.select({ providerId: schema.integrations.providerId, status: schema.integrations.connectionStatus }).from(schema.integrations).where(eq(schema.integrations.workspaceId, ws)),
      tx.execute<{ leads: unknown; rules: unknown; markets: unknown }>(sql`
        select (select count(*) from leads where workspace_id = ${ws}) as leads,
               (select count(*) from monitoring_rules where workspace_id = ${ws}) as rules,
               (select count(*) from target_markets where workspace_id = ${ws} and updated_at > created_at + interval '1 second') as markets`),
    ]);
    const [{ discoveries }] = (
      await systemDb().execute<{ discoveries: unknown }>(sql`select count(*) as discoveries from jobs where workspace_id = ${ws} and type = 'discovery_run'`)
    ).rows as { discoveries: unknown }[];
    const c = counts.rows[0];
    return {
      notifications,
      rules,
      onboarding: {
        marketsCustomized: Number(c?.markets ?? 0) > 0,
        testedSource: integrations.some((i) => i.status === "connected"),
        ranDiscovery: Number(discoveries) > 0,
        hasRule: Number(c?.rules ?? 0) > 0,
        hasLeads: Number(c?.leads ?? 0) > 0,
      },
    };
  });
}
