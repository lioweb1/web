import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { PageHeader } from "@/components/ui/card";
import { RuleForm } from "../rule-form";
import { ruleFormData, tagNames } from "../form-data";

export const metadata = { title: "Edit monitoring rule" };

export default async function EditRulePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole("member");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ws = ctx.workspace.id;
  const [rule] = await withTenant(ws, (tx) => tx.select().from(schema.monitoringRules).where(eq(schema.monitoringRules.id, id)));
  if (!rule) notFound();
  const [data, tags] = await Promise.all([ruleFormData(ws), tagNames(ws, rule.autoTagIds)]);
  const c = rule.criteria;
  return (
    <>
      <PageHeader title={`Edit: ${rule.name}`} />
      <RuleForm
        values={{
          ruleId: rule.id,
          name: rule.name,
          providerIds: rule.providerIds,
          countries: c.countries ?? [],
          cities: c.cities ?? [],
          industries: c.industries ?? [],
          businessTypes: c.businessTypes ?? [],
          categories: c.categories ?? [],
          keyword: c.keyword ?? "",
          websiteState: c.websiteState ?? "any",
          tlds: c.tlds ?? [],
          minScore: rule.minScore,
          contactRequirement: rule.contactRequirement as "none",
          autoAnalyzeWebsites: rule.autoAnalyzeWebsites,
          autoTags: tags,
          autoListId: rule.autoListId,
          notify: rule.notify,
          frequency: rule.frequency,
          customIntervalMinutes: rule.customIntervalMinutes,
          active: rule.active,
        }}
        {...data}
      />
    </>
  );
}
