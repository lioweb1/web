import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema, systemDb, withTenant } from "@/lib/db";
import { saveIntegration, listIntegrations, testIntegration, setHttpClientForTests } from "@/lib/services/integrations";
import { getKpis, getAnalytics, getJobStats, parseRange } from "@/lib/queries/analytics";
import { addMember, removeMember, setMemberRole, exportWorkspaceData, deleteAccount } from "@/lib/services/accounts";
import { createLead } from "@/lib/services/leads";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import { PREMIUM_MARKETS } from "@/lib/countries";
import { makeUser } from "./helpers/db";
import { fakeHttp } from "./helpers/fake-http";

describe("integration secrets", () => {
  let ws: string;
  beforeAll(async () => {
    ws = (await makeUser()).workspace.id;
  });

  it("are encrypted at rest and never returned raw", async () => {
    await saveIntegration(ws, "companies_house", { enabled: true, settings: {}, secrets: { apiKey: "super-secret-key-1234" } });
    const [row] = await withTenant(ws, (tx) => tx.select().from(schema.integrations).where(eq(schema.integrations.providerId, "companies_house")));
    expect(row.encryptedSecrets).toBeTruthy();
    expect(row.encryptedSecrets).not.toContain("super-secret");
    expect(JSON.parse(decryptSecret(row.encryptedSecrets!))).toEqual({ apiKey: "super-secret-key-1234" });
    const views = await listIntegrations(ws);
    const v = views.find((x) => x.providerId === "companies_house")!;
    expect(JSON.stringify(views)).not.toContain("super-secret");
    expect(v.maskedSecrets.apiKey).toBe("••••1234");
  });

  it("keeps a secret when left blank, clears on request", async () => {
    await saveIntegration(ws, "companies_house", { enabled: true, settings: {}, secrets: {} });
    expect((await listIntegrations(ws)).find((x) => x.providerId === "companies_house")!.maskedSecrets.apiKey).toBe("••••1234");
    await saveIntegration(ws, "companies_house", { enabled: true, settings: {}, secrets: { apiKey__clear: "1" } });
    expect((await listIntegrations(ws)).find((x) => x.providerId === "companies_house")!.maskedSecrets.apiKey).toBeUndefined();
  });

  it("only a passing test marks connected; changing config resets to untested", async () => {
    setHttpClientForTests(fakeHttp([{ match: "search/companies", body: { items: [] }, headers: { "x-ratelimit-remain": "599" } }]).client);
    await saveIntegration(ws, "companies_house", { enabled: true, settings: {}, secrets: { apiKey: "k1" } });
    const ok = await testIntegration(ws, "companies_house");
    expect(ok.ok).toBe(true);
    let v = (await listIntegrations(ws)).find((x) => x.providerId === "companies_house")!;
    expect(v.connectionStatus).toBe("connected");
    expect(v.remainingQuota).toBe(599);
    await saveIntegration(ws, "companies_house", { enabled: true, settings: {}, secrets: { apiKey: "k2" } });
    v = (await listIntegrations(ws)).find((x) => x.providerId === "companies_house")!;
    expect(v.connectionStatus).toBe("untested");
    setHttpClientForTests(fakeHttp([{ match: "search/companies", status: 401, body: "no" }]).client);
    const bad = await testIntegration(ws, "companies_house");
    expect(bad.ok).toBe(false);
    v = (await listIntegrations(ws)).find((x) => x.providerId === "companies_house")!;
    expect(v.connectionStatus).toBe("error");
    expect(v.lastError).toMatch(/401/);
    setHttpClientForTests(null);
  });

  it("refuses to enable unavailable providers", async () => {
    await expect(saveIntegration(ws, "linkedin", { enabled: true, settings: {}, secrets: {} })).rejects.toThrow(/cannot be enabled/);
  });
});

describe("analytics aggregates", () => {
  it("computes KPIs and breakdowns from stored data only", async () => {
    const { workspace } = await makeUser();
    const ws = workspace.id;
    const empty = await getKpis(ws, parseRange({}));
    expect(empty.totalLeads).toBe(0);
    expect(empty.conversionRate).toBeNull();
    await withTenant(ws, async (tx) => {
      const mk = async (name: string, cc: string | null, status: "new" | "contacted" | "won", score: number, email?: string) => {
        const [b] = await tx.insert(schema.businesses).values({ name, normalizedName: name.toLowerCase(), ownerWorkspaceId: ws, countryCode: cc, industry: "Healthcare", hasWebsite: true }).returning();
        const { lead } = await createLead(tx, ws, b.id, { providerId: "osm" });
        await tx.update(schema.leads).set({ status, score }).where(eq(schema.leads.id, lead.id));
        if (email) await tx.insert(schema.contacts).values({ businessId: b.id, type: "email", value: email, normalizedValue: email, providerId: "osm", verificationStatus: "domain_valid" });
      };
      await mk("A", "DE", "new", 80, "a@a.de");
      await mk("B", "DE", "contacted", 40);
      await mk("C", "US", "won", 95);
      await mk("D", null, "won", 10);
    });
    await systemDb().insert(schema.jobs).values([
      { workspaceId: ws, type: "discovery_run", payload: { providerId: "osm" }, status: "succeeded" },
      { workspaceId: ws, type: "discovery_run", payload: { providerId: "osm" }, status: "dead" },
    ]);
    const r = parseRange({ range: "7" });
    const k = await getKpis(ws, r);
    expect(k).toMatchObject({ totalLeads: 4, newLeads: 4, highPotential: 2, emailsDomainValid: 1, emailsVerified: 0, contacted: 3, won: 2, qualified: 3 });
    expect(k.conversionRate).toBeCloseTo(2 / 3);
    const de = await getKpis(ws, { ...r, countries: ["DE"] });
    expect(de.totalLeads).toBe(2);
    const a = await getAnalytics(ws, r);
    expect(a.byCountry.find((c) => c.key === "DE")?.value).toBe(2);
    expect(a.byCountry.find((c) => c.key === "unknown")?.value).toBe(1);
    expect(a.byRegion.find((x) => x.key === "Europe")?.value).toBe(2);
    expect(a.quality.find((q) => q.key === "excellent")?.value).toBe(1);
    expect(a.trend.reduce((s, d) => s + d.value, 0)).toBe(4);
    expect(a.pipeline.find((p) => p.key === "won")?.value).toBe(2);
    const j = await getJobStats(ws, r);
    expect(j.reliability[0]).toMatchObject({ key: "osm", succeeded: 1, failed: 1 });
  });
});

describe("target markets, webhooks, export, accounts", () => {
  it("new workspaces default to Premium Markets; markets are workspace-scoped", async () => {
    const { workspace } = await makeUser();
    const [ws] = await systemDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, workspace.id));
    const markets = await withTenant(workspace.id, (tx) => tx.select().from(schema.targetMarkets));
    expect(markets).toHaveLength(1);
    expect(markets[0].id).toBe(ws.defaultTargetMarketId);
    expect(markets[0].countries.sort()).toEqual([...PREMIUM_MARKETS].sort());
    const [custom] = await withTenant(workspace.id, (tx) => tx.insert(schema.targetMarkets).values({ workspaceId: workspace.id, name: "Gulf", mode: "custom", countries: ["AE", "SA"] }).returning());
    await systemDb().update(schema.workspaces).set({ defaultTargetMarketId: custom.id }).where(eq(schema.workspaces.id, workspace.id));
    await withTenant(workspace.id, (tx) => tx.update(schema.targetMarkets).set({ countries: ["AE"] }).where(eq(schema.targetMarkets.id, custom.id)));
    await withTenant(workspace.id, (tx) => tx.delete(schema.targetMarkets).where(eq(schema.targetMarkets.id, markets[0].id)));
    expect(await withTenant(workspace.id, (tx) => tx.select().from(schema.targetMarkets))).toHaveLength(1);
  });

  it("webhook secrets are encrypted and exports contain no secrets", async () => {
    const { workspace } = await makeUser();
    await withTenant(workspace.id, (tx) => tx.insert(schema.webhooks).values({ workspaceId: workspace.id, url: "https://h.example", events: ["lead.created"], encryptedSecret: encryptSecret("whsec_plain") }));
    await saveIntegration(workspace.id, "companies_house", { enabled: true, settings: {}, secrets: { apiKey: "export-secret-999" } });
    const [h] = await withTenant(workspace.id, (tx) => tx.select().from(schema.webhooks));
    expect(h.encryptedSecret).not.toContain("whsec_plain");
    const dump = JSON.stringify(await exportWorkspaceData(workspace.id));
    expect(dump).not.toContain("export-secret-999");
    expect(dump).not.toContain("whsec");
    expect(dump).not.toContain("password");
  });

  it("member role rules: cannot remove or demote the last owner", async () => {
    const owner = await makeUser("Owner");
    const other = await makeUser("Other");
    await expect(removeMember(owner.workspace.id, owner.user.id)).rejects.toThrow(/at least one owner/);
    await expect(setMemberRole(owner.workspace.id, owner.user.id, "admin")).rejects.toThrow(/at least one owner/);
    await addMember(owner.workspace.id, other.email, "member");
    await setMemberRole(owner.workspace.id, other.user.id, "owner");
    await setMemberRole(owner.workspace.id, owner.user.id, "admin"); // now allowed
    await removeMember(owner.workspace.id, owner.user.id);
    await expect(addMember(owner.workspace.id, "nobody@nowhere.test", "member")).rejects.toThrow(/No LeadOrbit account/);
  });

  it("deleteAccount removes sole-member workspaces and anonymizes the user", async () => {
    const solo = await makeUser("Solo");
    const shared = await makeUser("Shared owner");
    await addMember(shared.workspace.id, solo.email, "admin");
    await deleteAccount(solo.user.id);
    expect(await systemDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, solo.workspace.id))).toHaveLength(0);
    expect(await systemDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, shared.workspace.id))).toHaveLength(1);
    const [u] = await systemDb().select().from(schema.users).where(eq(schema.users.id, solo.user.id));
    expect(u.deletedAt).toBeTruthy();
    expect(u.email).not.toBe(solo.email);
    expect(u.name).toBe("Deleted user");
    const [{ n }] = (await systemDb().execute<{ n: number }>(sql`select count(*)::int as n from memberships where user_id = ${solo.user.id}`)).rows;
    expect(n).toBe(0);
  });
});
