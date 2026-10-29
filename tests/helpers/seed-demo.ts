/**
 * Dev-only: seed a workspace by replaying the recorded OpenStreetMap + website fixtures from
 * tests/fixtures, so the UI can be reviewed without network access.
 * Usage: npx tsx --env-file=.env tests/helpers/seed-demo.ts <email>
 */
import { eq, sql } from "drizzle-orm";
import { systemDb, schema, withTenant, closeDb } from "@/lib/db";
import { runDiscovery } from "@/lib/discovery/pipeline";
import { setHttpClientForTests } from "@/lib/services/integrations";
import { saveBusinessesAsLeads } from "@/lib/services/workspace-discovery";
import { analyzeWebsite } from "@/lib/analysis/analyzer";
import { storeAnalysis, rescoreLead } from "@/lib/services/enrich";
import { fakeHttp } from "./fake-http";
import { nominatimBerlin, overpassBerlin, dentistHomepage, dentistContact } from "../fixtures/osm";

async function main() {
  const email = process.argv[2];
  const [u] = await systemDb().select().from(schema.users).where(sql`lower(${schema.users.email}) = lower(${email})`);
  if (!u?.defaultWorkspaceId) throw new Error("user not found");
  const ws = u.defaultWorkspaceId;
  setHttpClientForTests(fakeHttp([{ match: "nominatim", body: nominatimBerlin }, { match: "overpass", body: overpassBerlin }]).client);
  const run = await runDiscovery(ws, "osm", { countries: ["DE"], cities: ["Berlin"] });
  await saveBusinessesAsLeads(ws, u.id, run.businessIds, "osm");
  const http = fakeHttp([
    { match: "/robots.txt", body: "User-agent: *\nAllow: /" },
    { match: /^http:\/\//, status: 301, body: "", headers: { location: "https://zahnarzt-mueller.de/" } },
    { match: "/kontakt", body: dentistContact },
    { match: "/team", body: "<html></html>" },
    { match: "/old-page", status: 404, body: "" },
    { match: "https://zahnarzt-mueller.de", body: dentistHomepage, headers: { server: "Apache" } },
  ]);
  const r = await analyzeWebsite("https://zahnarzt-mueller.de", {
    http: http.client,
    resolve: async () => ["93.184.216.34"],
    tls: async () => ({ valid: true, issuer: "Let's Encrypt", validTo: new Date(Date.now() + 5e9), error: null }),
  });
  const [biz] = await withTenant(ws, (tx) => tx.select().from(schema.businesses).where(eq(schema.businesses.domain, "zahnarzt-mueller.de")));
  await withTenant(ws, (tx) => storeAnalysis(tx, biz.id, r));
  const [lead] = await withTenant(ws, (tx) => tx.select().from(schema.leads).where(eq(schema.leads.businessId, biz.id)));
  await rescoreLead(ws, lead.id);
  console.log(`lead ${lead.id}`);
  await closeDb();
}

main();
