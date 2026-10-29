"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action, zBool } from "@/lib/action";
import { enrichDomain } from "@/lib/services/enrich";
import { analyzeAdHoc } from "@/lib/services/workspace-discovery";
import { registrableDomain } from "@/lib/discovery/normalize";
import { withTenant, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { analyzeAdHocBusiness } from "./helpers";

export const lookupDomainAction = action({ schema: z.object({ domain: z.string().trim().min(3).max(253), analyze: zBool }), role: "member", audit: "domain.lookup" }, async (ctx, i) => {
  const domain = registrableDomain(i.domain.includes("://") ? i.domain : `https://${i.domain}`);
  if (!domain) return { error: "Enter a registrable domain such as example.com" };
  const ws = ctx.workspace.id;
  // Attach the lookup to a workspace-visible business (private one if new) so it appears in this workspace's list.
  let analysisNote = "";
  if (i.analyze) {
    try {
      await analyzeAdHoc(ws, domain);
      analysisNote = " Website analyzed.";
    } catch (e) {
      analysisNote = ` Website analysis failed: ${e instanceof Error ? e.message : String(e)}.`;
    }
  } else {
    await analyzeAdHocBusiness(ws, domain);
  }
  const r = await enrichDomain(ws, domain);
  const d = await withTenant(ws, async (tx) => (await tx.select().from(schema.domains).where(eq(schema.domains.domain, domain)))[0]);
  revalidatePath("/app/domains");
  const reg = d?.registeredAt ? `registered ${d.registeredAt.toISOString().slice(0, 10)}${d.registrar ? ` via ${d.registrar}` : ""}` : r.rdapFound === false ? "not found in RDAP (may be unregistered)" : r.rdapFound === null ? "RDAP lookup failed or disabled — see Data sources" : "registration date not published";
  return { ok: true, message: `${domain}: ${reg}. ${d?.dnsMx?.length ? `${d.dnsMx.length} MX record(s).` : "No MX records found."}${analysisNote}` };
});
