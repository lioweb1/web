import { requireRole } from "@/lib/auth/session";
import { parseFilters } from "@/lib/services/leads";
import { workspaceTarget } from "@/lib/services/enrich";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/states";
import { RuleForm, type RuleFormValues } from "../rule-form";
import { ruleFormData } from "../form-data";

export const metadata = { title: "New monitoring rule" };

export default async function NewRulePage({ searchParams }: { searchParams: Promise<{ fromSearch?: string; provider?: string }> }) {
  const ctx = await requireRole("member");
  const sp = await searchParams;
  const ws = ctx.workspace.id;
  const [data, target] = await Promise.all([ruleFormData(ws), withTenant(ws, (tx) => workspaceTarget(tx, ws))]);
  const f = sp.fromSearch ? parseFilters(new URLSearchParams(sp.fromSearch)) : null;
  const values: RuleFormValues = {
    name: f ? "Rule from saved search" : "",
    providerIds: sp.provider ? [sp.provider] : [],
    countries: f?.country ?? target.countries,
    cities: f?.city ? [f.city] : [],
    industries: f?.industry ? [f.industry] : target.industries,
    businessTypes: f?.businessType ? [f.businessType] : [],
    categories: [],
    keyword: f?.q ?? "",
    websiteState: f?.website === "has" ? "has_website" : f?.website === "none" ? "no_website" : "any",
    tlds: ["com"],
    minScore: f?.scoreMin ?? 50,
    contactRequirement: f?.hasEmail ? "email" : f?.hasPhone ? "phone" : "none",
    autoAnalyzeWebsites: true,
    autoTags: [],
    autoListId: f?.list ?? null,
    notify: true,
    frequency: "daily",
    customIntervalMinutes: null,
    active: true,
  };
  return (
    <>
      <PageHeader title="New monitoring rule" description="Example: “When a new business matching my criteria is discovered in the United States, save the lead and notify me.”" />
      {f ? <Notice className="mb-4">Pre-filled from a saved search. Choose the data sources to monitor — filters that sources cannot apply (e.g. CMS) are used when scoring and qualifying.</Notice> : null}
      <RuleForm values={values} {...data} />
    </>
  );
}
