import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { providerContext, recordProviderResult } from "./integrations";
import { assertOk, parseJson } from "@/lib/providers/http";
import { countryName } from "@/lib/countries";
import { appUrl } from "@/lib/notifications/email";

/** Create (or find by domain) a Company in HubSpot's free CRM for a lead. */
export async function pushLeadToHubspot(workspaceId: string, leadId: string) {
  const ctx = await providerContext(workspaceId, "hubspot");
  if (!ctx.enabled || !ctx.secrets.token) throw new Error("HubSpot is not configured. Add a private app token on the Integrations page.");
  const data = await withTenant(workspaceId, async (tx) => {
    const [row] = await tx.select({ lead: schema.leads, business: schema.businesses }).from(schema.leads).innerJoin(schema.businesses, eq(schema.businesses.id, schema.leads.businessId)).where(eq(schema.leads.id, leadId));
    if (!row) throw new Error("Lead not found");
    const contacts = await tx.select().from(schema.contacts).where(eq(schema.contacts.businessId, row.business.id));
    return { ...row, contacts };
  });
  const b = data.business;
  const headers = { Authorization: `Bearer ${ctx.secrets.token}`, "Content-Type": "application/json" };
  try {
    let companyId: string | null = null;
    if (b.domain) {
      const search = await ctx.http("https://api.hubapi.com/crm/v3/objects/companies/search", {
        method: "POST",
        headers,
        body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: b.domain }] }], limit: 1 }),
      });
      assertOk(search, "HubSpot");
      companyId = parseJson<{ results: { id: string }[] }>(search, "HubSpot").results[0]?.id ?? null;
    }
    if (!companyId) {
      const phone = data.contacts.find((c) => c.type === "phone")?.value;
      const res = await ctx.http("https://api.hubapi.com/crm/v3/objects/companies", {
        method: "POST",
        headers,
        body: JSON.stringify({
          properties: {
            name: b.name,
            ...(b.domain ? { domain: b.domain } : {}),
            ...(b.websiteUrl ? { website: b.websiteUrl } : {}),
            ...(phone ? { phone } : {}),
            ...(b.city ? { city: b.city } : {}),
            ...(b.countryCode ? { country: countryName(b.countryCode) } : {}),
            description: `LeadOrbit score ${data.lead.score}/100. ${appUrl(`/app/leads/${leadId}`)}`,
          },
        }),
        retries: 1,
      });
      assertOk(res, "HubSpot");
      companyId = parseJson<{ id: string }>(res, "HubSpot").id;
    }
    await recordProviderResult(workspaceId, "hubspot", { ok: true });
    await withTenant(workspaceId, (tx) => tx.insert(schema.activities).values({ workspaceId, leadId, kind: "system", summary: `Sent to HubSpot (company ${companyId})`, metadata: { hubspotCompanyId: companyId } }));
    return { hubspotCompanyId: companyId };
  } catch (e) {
    await recordProviderResult(workspaceId, "hubspot", { ok: false, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
