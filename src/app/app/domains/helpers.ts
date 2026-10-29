import { schema, withTenant } from "@/lib/db";
import { findDuplicate } from "@/lib/discovery/pipeline";
import { normalizeName } from "@/lib/discovery/normalize";

/** Ensure a business visible to this workspace exists for the domain (private if new). */
export async function analyzeAdHocBusiness(workspaceId: string, domain: string) {
  return withTenant(workspaceId, async (tx) => {
    const dup = await findDuplicate(tx, { domain, normalizedName: normalizeName(domain) });
    if (dup) return dup.id;
    const [b] = await tx
      .insert(schema.businesses)
      .values({ ownerWorkspaceId: workspaceId, name: domain, normalizedName: normalizeName(domain), websiteUrl: `https://${domain}`, domain, externalKeys: [`manual:${workspaceId}:${domain}`] })
      .returning();
    return b.id;
  });
}
