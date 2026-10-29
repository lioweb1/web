"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { action, zUuid } from "@/lib/action";
import { analyzeAdHoc, saveBusinessesAsLeads } from "@/lib/services/workspace-discovery";
import { analyzeBusiness } from "@/lib/services/enrich";

export const analyzeUrlAction = action({ schema: z.object({ url: z.string().trim().min(3, "Enter a website").max(500) }), role: "member", audit: "website.analyze" }, async (ctx, i) => {
  const r = await analyzeAdHoc(ctx.workspace.id, i.url);
  redirect(`/app/websites/${r.analysisId}`);
});

export const reanalyzeAction = action({ schema: z.object({ businessId: zUuid }), role: "member" }, async (ctx, i) => {
  const row = await analyzeBusiness(ctx.workspace.id, i.businessId);
  if (!row) return { error: "This business has no website to analyze." };
  redirect(`/app/websites/${row.id}`);
});

export const saveAnalysisLeadAction = action({ schema: z.object({ businessId: zUuid }), role: "member", audit: "lead.save_from_analysis" }, async (ctx, i) => {
  const r = await saveBusinessesAsLeads(ctx.workspace.id, ctx.user.id, [i.businessId], "website_analyzer");
  return { ok: true, message: r.created.length ? "Saved as a lead. Scoring and enrichment run in the background." : "This business is already one of your leads." };
});
