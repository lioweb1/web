"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action, simpleAction, zArr, zCsv, zUuid } from "@/lib/action";
import { startManualDiscovery, saveBusinessesAsLeads } from "@/lib/services/workspace-discovery";
import { retryJob } from "@/lib/jobs/queue";

const discoverSchema = z.object({
  providerId: z.string().min(1),
  countries: zCsv,
  cities: zCsv,
  categories: zArr,
  keyword: z.string().trim().max(80).optional(),
  websiteState: z.enum(["any", "has_website", "no_website"]).optional(),
  tlds: zCsv,
});

export const startDiscoveryAction = action({ schema: discoverSchema, role: "member", audit: "discovery.run" }, async (ctx, i) => {
  const job = await startManualDiscovery(ctx.workspace.id, ctx.user.id, i.providerId, {
    countries: i.countries.map((c) => c.toUpperCase()),
    cities: i.cities,
    categories: i.categories,
    keyword: i.keyword || undefined,
    websiteState: i.websiteState ?? "any",
    tlds: i.tlds,
  });
  redirect(`/app/discover?run=${job.id}`);
});

export const saveLeadsAction = action(
  { schema: z.object({ businessIds: zArr.pipe(z.array(zUuid).min(1, "Select at least one business").max(500)), providerId: z.string().optional(), runId: z.string().optional() }), role: "member", audit: "leads.save_from_discovery" },
  async (ctx, i) => {
    const r = await saveBusinessesAsLeads(ctx.workspace.id, ctx.user.id, i.businessIds, i.providerId || null);
    revalidatePath("/app/discover");
    return { ok: true, message: `${r.created.length} lead${r.created.length === 1 ? "" : "s"} saved${r.existing ? `, ${r.existing} already saved` : ""}. Enrichment and scoring run in the background.` };
  },
);

export const retryRunAction = simpleAction({ schema: z.object({ jobId: zUuid }), role: "member" }, async (ctx, i) => {
  await retryJob(ctx.workspace.id, i.jobId);
  revalidatePath("/app/discover");
});
