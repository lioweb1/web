import { eq, inArray } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { DISCOVERY_PROVIDERS } from "@/lib/providers/registry";
import { OSM_CATEGORIES } from "@/lib/providers/osm";
import { providerContext } from "@/lib/services/integrations";

/** Data the rule form needs, serialized for the client component. */
export async function ruleFormData(workspaceId: string) {
  const providers = await Promise.all(
    DISCOVERY_PROVIDERS.map(async (p) => {
      const c = await providerContext(workspaceId, p.id);
      return { id: p.id, name: p.name, minInterval: p.minIntervalMinutes, supported: p.supportedCountries === "all" ? "worldwide where listed" : `only ${p.supportedCountries.join(", ")}`, status: !c.enabled ? "disabled" : !c.configured ? "needs API key" : "ready" };
    }),
  );
  const lists = await withTenant(workspaceId, (tx) => tx.select({ id: schema.leadLists.id, name: schema.leadLists.name }).from(schema.leadLists).where(eq(schema.leadLists.workspaceId, workspaceId)));
  return { providers, lists, categories: OSM_CATEGORIES.map((c) => ({ id: c.id, label: c.label })) };
}

export async function tagNames(workspaceId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await withTenant(workspaceId, (tx) => tx.select({ name: schema.tags.name }).from(schema.tags).where(inArray(schema.tags.id, ids)));
  return rows.map((r) => r.name);
}
