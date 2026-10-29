import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, systemDb, withTenant } from "@/lib/db";
import { setHttpClientForTests, saveIntegration } from "@/lib/services/integrations";
import { netDeps } from "@/lib/services/enrich";
import { runJobs } from "@/lib/jobs/runner";
import { createRule, setRuleActive, validateRule, type RuleInput } from "@/lib/services/monitoring";
import { startManualDiscovery, saveBusinessesAsLeads, createLeadFromSignal, analyzeAdHoc } from "@/lib/services/workspace-discovery";
import { insertSignals } from "@/lib/discovery/pipeline";
import { fakeHttp } from "./helpers/fake-http";
import { makeUser } from "./helpers/db";
import { chSearch } from "./fixtures/companies-house";
import { dentistHomepage } from "./fixtures/osm";

const baseRule: RuleInput = { name: "R", providerIds: ["osm"], criteria: {}, minScore: 0, contactRequirement: "none", autoAnalyzeWebsites: false, notify: false, frequency: "daily", customIntervalMinutes: null, active: true };
const original = { ...netDeps };

describe("discovery & automation UI services", () => {
  let ws: string, userId: string, other: string;
  beforeAll(async () => {
    const u = await makeUser("Auto");
    ws = u.workspace.id;
    userId = u.user.id;
    other = (await makeUser("Other")).workspace.id;
    await systemDb().update(schema.jobs).set({ status: "cancelled" });
    netDeps.resolve = async () => ["93.184.216.34"];
    netDeps.tls = async () => ({ valid: true, issuer: "Test CA", validTo: new Date(Date.now() + 90 * 86400_000), error: null });
    netDeps.dns = { resolveMx: async () => [{ exchange: "mx.example", priority: 1 }], resolveA: async () => ["93.184.216.34"] };
  });
  afterAll(() => {
    setHttpClientForTests(null);
    Object.assign(netDeps, original);
  });

  it("manual discovery run → results → save selected as scored leads", async () => {
    setHttpClientForTests(fakeHttp([{ match: "advanced-search/companies", body: chSearch }]).client);
    await saveIntegration(ws, "companies_house", { enabled: true, settings: {}, secrets: { apiKey: "k" } });
    const job = await startManualDiscovery(ws, userId, "companies_house", { countries: ["GB"] });
    await runJobs({ workerId: "t", budgetMs: 10_000, types: ["discovery_run"] });
    const [done] = await systemDb().select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(done.status).toBe("succeeded");
    const ids = (done.result as { businessIds: string[] }).businessIds;
    expect(ids).toHaveLength(2);
    const r = await saveBusinessesAsLeads(ws, userId, ids, "companies_house");
    expect(r.created).toHaveLength(2);
    const again = await saveBusinessesAsLeads(ws, userId, ids, "companies_house");
    expect(again).toMatchObject({ created: [], existing: 2 });
    const leads = await withTenant(ws, (tx) => tx.select().from(schema.leads));
    expect(leads.every((l) => l.scoredAt && l.scoreFactors.length === 10)).toBe(true);
    const enrich = await systemDb().select().from(schema.jobs).where(eq(schema.jobs.type, "enrich_lead"));
    expect(enrich.filter((j) => j.workspaceId === ws)).toHaveLength(2);
  });

  it("rejects invalid manual runs", async () => {
    await expect(startManualDiscovery(ws, userId, "osm", { countries: ["DE"] })).rejects.toThrow(/one country and at least one city/);
    await expect(startManualDiscovery(ws, userId, "crtsh", { keyword: "ab" })).rejects.toThrow(/4 letters/);
    await expect(startManualDiscovery(ws, userId, "linkedin", {})).rejects.toThrow();
  });

  it("validates monitoring rules", () => {
    expect(validateRule({ ...baseRule, criteria: { countries: ["DE", "FR"], cities: ["Berlin"] } })).toMatch(/exactly one country/);
    expect(validateRule({ ...baseRule, criteria: { countries: ["DE"] } })).toMatch(/at least one city/);
    expect(validateRule({ ...baseRule, providerIds: ["crtsh"], criteria: { keyword: "abc" } })).toMatch(/keyword/);
    expect(validateRule({ ...baseRule, providerIds: ["facebook"] })).toMatch(/cannot be used/);
    expect(validateRule({ ...baseRule, frequency: "custom", customIntervalMinutes: 5, criteria: { countries: ["DE"], cities: ["Berlin"] } })).toMatch(/15 minutes/);
    expect(validateRule({ ...baseRule, criteria: { countries: ["DE"], cities: ["Berlin"] } })).toBeNull();
  });

  it("pause clears and resume sets nextRunAt", async () => {
    const rule = await createRule(ws, userId, { ...baseRule, criteria: { countries: ["DE"], cities: ["Berlin"] } });
    expect(rule.nextRunAt).toBeTruthy();
    await setRuleActive(ws, rule.id, false);
    let [r] = await withTenant(ws, (tx) => tx.select().from(schema.monitoringRules).where(eq(schema.monitoringRules.id, rule.id)));
    expect(r.active).toBe(false);
    expect(r.nextRunAt).toBeNull();
    await setRuleActive(ws, rule.id, true);
    [r] = await withTenant(ws, (tx) => tx.select().from(schema.monitoringRules).where(eq(schema.monitoringRules.id, rule.id)));
    expect(r.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });

  it("creates a lead from an unattributed signal", async () => {
    await withTenant(ws, (tx) => insertSignals(tx, ws, null, "hackernews", [{ type: "website_requirement", title: "Looking for a web developer for our bakery", externalId: "hn:999", url: "https://news.ycombinator.com/item?id=999", publishedAt: new Date() }]));
    const [sig] = await withTenant(ws, (tx) => tx.select().from(schema.businessSignals).where(eq(schema.businessSignals.externalId, "hn:999")));
    const leadId = await createLeadFromSignal(ws, userId, sig.id, { name: "Crumb & Co", countryCode: "GB" });
    const [lead] = await withTenant(ws, (tx) => tx.select().from(schema.leads).where(eq(schema.leads.id, leadId)));
    expect(lead.scoreFactors.find((f) => f.key === "demand")!.points).toBe(15);
    const [linked] = await withTenant(ws, (tx) => tx.select().from(schema.businessSignals).where(eq(schema.businessSignals.id, sig.id)));
    expect(linked.businessId).toBe(lead.businessId);
    const [biz] = await withTenant(ws, (tx) => tx.select().from(schema.businesses).where(eq(schema.businesses.id, lead.businessId)));
    expect(biz.ownerWorkspaceId).toBe(ws); // no website → private record
    expect(await withTenant(other, (tx) => tx.select().from(schema.businesses).where(eq(schema.businesses.id, biz.id)))).toHaveLength(0);
  });

  it("ad-hoc website analysis stays private to the workspace", async () => {
    setHttpClientForTests(
      fakeHttp([
        { match: "/robots.txt", status: 404, body: "" },
        { match: /^http:\/\/private-site\.com/, status: 301, body: "", headers: { location: "https://private-site.com/" } },
        { match: "private-site.com", body: dentistHomepage.replace(/zahnarzt-mueller\.de/g, "private-site.com") },
      ]).client,
    );
    const r = await analyzeAdHoc(ws, "private-site.com");
    const [a] = await withTenant(ws, (tx) => tx.select().from(schema.websiteAnalyses).where(eq(schema.websiteAnalyses.id, r.analysisId)));
    expect(a.reachable).toBe(true);
    expect(a.businessId).toBe(r.businessId);
    expect(await withTenant(other, (tx) => tx.select().from(schema.websiteAnalyses).where(eq(schema.websiteAnalyses.id, r.analysisId)))).toHaveLength(0);
    const contacts = await withTenant(other, (tx) => tx.select().from(schema.contacts).where(eq(schema.contacts.businessId, r.businessId)));
    expect(contacts).toHaveLength(0);
    await expect(analyzeAdHoc(ws, "not a url")).rejects.toThrow(/valid public website/);
  });
});
