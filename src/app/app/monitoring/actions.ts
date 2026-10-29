"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action, simpleAction, zArr, zBool, zCsv, zUuid } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { ensureTag } from "@/lib/services/leads";
import { createRule, updateRule, setRuleActive, runRuleNow, deleteRule, type RuleInput } from "@/lib/services/monitoring";

const ruleSchema = z.object({
  ruleId: z.string().optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  providerIds: zArr,
  countries: zCsv,
  cities: zCsv,
  industries: zCsv,
  businessTypes: zCsv,
  categories: zArr,
  keyword: z.string().trim().max(80).optional(),
  websiteState: z.enum(["any", "has_website", "no_website"]).default("any"),
  tlds: zCsv,
  minScore: z.coerce.number().int().min(0).max(100),
  contactRequirement: z.enum(["none", "email", "phone", "any"]),
  autoAnalyzeWebsites: zBool,
  autoTags: zCsv,
  autoListId: z.string().optional(),
  notify: zBool,
  frequency: z.enum(["manual", "hourly", "daily", "weekly", "custom"]),
  customIntervalMinutes: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().min(15).max(43200).nullable()),
  active: zBool,
});

export const saveRuleAction = action({ schema: ruleSchema, role: "member", audit: "monitoring.save_rule" }, async (ctx, i) => {
  const ws = ctx.workspace.id;
  const tagIds = await withTenant(ws, async (tx) => {
    const ids: string[] = [];
    for (const name of i.autoTags.slice(0, 10)) ids.push((await ensureTag(tx, ws, name)).id);
    return ids;
  });
  const input: RuleInput = {
    name: i.name,
    providerIds: i.providerIds,
    criteria: {
      countries: i.countries.map((c) => c.toUpperCase()),
      cities: i.cities,
      industries: i.industries,
      businessTypes: i.businessTypes,
      categories: i.categories,
      keyword: i.keyword || undefined,
      websiteState: i.websiteState,
      tlds: i.tlds,
    },
    minScore: i.minScore,
    contactRequirement: i.contactRequirement,
    autoAnalyzeWebsites: i.autoAnalyzeWebsites,
    autoTagIds: tagIds,
    autoListId: i.autoListId && /^[0-9a-f-]{36}$/i.test(i.autoListId) ? i.autoListId : null,
    notify: i.notify,
    frequency: i.frequency,
    customIntervalMinutes: i.frequency === "custom" ? i.customIntervalMinutes : null,
    active: i.active,
  };
  if (i.ruleId) await updateRule(ws, i.ruleId, input);
  else await createRule(ws, ctx.user.id, input);
  revalidatePath("/app/monitoring");
  redirect("/app/monitoring");
});

const idSchema = z.object({ ruleId: zUuid });

export const toggleRuleAction = simpleAction({ schema: z.object({ ruleId: zUuid, active: zBool }), role: "member", audit: "monitoring.toggle_rule" }, async (ctx, i) => {
  await setRuleActive(ctx.workspace.id, i.ruleId, i.active);
  revalidatePath("/app/monitoring");
});

export const runRuleNowAction = simpleAction({ schema: idSchema, role: "member", audit: "monitoring.run_now" }, async (ctx, i) => {
  await runRuleNow(ctx.workspace.id, i.ruleId);
  revalidatePath("/app/monitoring");
});

export const deleteRuleAction = simpleAction({ schema: idSchema, role: "member", audit: "monitoring.delete_rule" }, async (ctx, i) => {
  await deleteRule(ctx.workspace.id, i.ruleId);
  revalidatePath("/app/monitoring");
});
