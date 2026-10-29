import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import type { RuleCriteria } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers/registry";
import { assertCountBelow } from "@/lib/plans";
import { nextRunAt, enqueueRuleRun } from "@/lib/jobs/scheduler";
import { isCountryCode } from "@/lib/countries";

export type RuleInput = {
  name: string;
  providerIds: string[];
  criteria: RuleCriteria;
  minScore: number;
  contactRequirement: "none" | "email" | "phone" | "any";
  autoAnalyzeWebsites: boolean;
  autoTagIds?: string[];
  autoListId?: string | null;
  notify: boolean;
  frequency: "manual" | "hourly" | "daily" | "weekly" | "custom";
  customIntervalMinutes: number | null;
  active: boolean;
};

export function validateRule(input: RuleInput): string | null {
  if (!input.name.trim()) return "Name is required";
  if (!input.providerIds.length) return "Select at least one data source";
  for (const p of input.providerIds) {
    const def = getProvider(p);
    if (!def?.discover || def.unavailableReason) return `${p} cannot be used for discovery`;
  }
  if (input.criteria.countries?.some((c) => !isCountryCode(c))) return "Unknown country code";
  if (input.providerIds.includes("osm") && (input.criteria.countries?.length !== 1 || !input.criteria.cities?.length)) return "OpenStreetMap rules need exactly one country and at least one city";
  if (input.providerIds.includes("crtsh") && (input.criteria.keyword?.trim().length ?? 0) < 4) return "Certificate Transparency rules need a keyword of at least 4 letters";
  if (input.minScore < 0 || input.minScore > 100) return "Score threshold must be 0–100";
  if (input.frequency === "custom" && (!input.customIntervalMinutes || input.customIntervalMinutes < 15)) return "Custom interval must be at least 15 minutes";
  return null;
}

export async function createRule(workspaceId: string, userId: string, input: RuleInput) {
  const err = validateRule(input);
  if (err) throw new Error(err);
  return withTenant(workspaceId, async (tx) => {
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.monitoringRules).where(eq(schema.monitoringRules.workspaceId, workspaceId));
    await assertCountBelow(workspaceId, "monitoringRules", count);
    const [rule] = await tx
      .insert(schema.monitoringRules)
      .values({ workspaceId, createdById: userId, ...input, autoTagIds: input.autoTagIds ?? [], nextRunAt: input.active && input.frequency !== "manual" ? new Date(Date.now() + 60_000) : null })
      .returning();
    return rule;
  });
}

export async function updateRule(workspaceId: string, ruleId: string, input: RuleInput) {
  const err = validateRule(input);
  if (err) throw new Error(err);
  return withTenant(workspaceId, async (tx) => {
    const [rule] = await tx
      .update(schema.monitoringRules)
      .set({ ...input, autoTagIds: input.autoTagIds ?? [], nextRunAt: input.active ? nextRunAt(input) : null, updatedAt: new Date() })
      .where(and(eq(schema.monitoringRules.id, ruleId), eq(schema.monitoringRules.workspaceId, workspaceId)))
      .returning();
    return rule;
  });
}

export async function setRuleActive(workspaceId: string, ruleId: string, active: boolean) {
  return withTenant(workspaceId, async (tx) => {
    const [rule] = await tx.select().from(schema.monitoringRules).where(eq(schema.monitoringRules.id, ruleId));
    if (!rule) throw new Error("Rule not found");
    await tx.update(schema.monitoringRules).set({ active, nextRunAt: active ? nextRunAt(rule) : null, updatedAt: new Date() }).where(eq(schema.monitoringRules.id, ruleId));
  });
}

export async function runRuleNow(workspaceId: string, ruleId: string) {
  const [rule] = await withTenant(workspaceId, (tx) => tx.select().from(schema.monitoringRules).where(eq(schema.monitoringRules.id, ruleId)));
  if (!rule) throw new Error("Rule not found");
  return enqueueRuleRun(rule, `manual:${Date.now()}`, { manual: true });
}

export async function deleteRule(workspaceId: string, ruleId: string) {
  await withTenant(workspaceId, (tx) => tx.delete(schema.monitoringRules).where(and(eq(schema.monitoringRules.id, ruleId), eq(schema.monitoringRules.workspaceId, workspaceId))));
}
