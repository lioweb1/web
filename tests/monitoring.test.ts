import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, systemDb, withTenant } from "@/lib/db";
import { setHttpClientForTests, saveIntegration } from "@/lib/services/integrations";
import { createRule } from "@/lib/services/monitoring";
import { schedulerTick, intervalMinutes } from "@/lib/jobs/scheduler";
import { runJobs } from "@/lib/jobs/runner";
import { retryJob, backoffMs } from "@/lib/jobs/queue";
import { setWebhookResolverForTests } from "@/lib/jobs/handlers";
import { encryptSecret, hmacSha256 } from "@/lib/security/crypto";
import { captureEmailsForTests } from "@/lib/notifications/email";
import { fakeHttp } from "./helpers/fake-http";
import { makeUser } from "./helpers/db";
import { chSearch } from "./fixtures/companies-house";

const future = () => new Date(Date.now() + 3 * 60_000);

async function drain() {
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const n = await runJobs({ workerId: "test", budgetMs: 10_000 });
    total += n;
    if (!n) break;
  }
  return total;
}

describe("monitoring rule → discovery → qualification → notification", () => {
  let ws: string, userId: string;
  const hookCalls: { headers: Record<string, string>; body: string }[] = [];
  beforeAll(async () => {
    const u = await makeUser("Monitor");
    ws = u.workspace.id;
    userId = u.user.id;
    await systemDb().update(schema.jobs).set({ status: "cancelled" }); // isolate from other test files
    await saveIntegration(ws, "companies_house", { enabled: true, settings: {}, secrets: { apiKey: "test-key" } });
    await withTenant(ws, (tx) => tx.insert(schema.notificationPrefs).values({ workspaceId: ws, userId, prefs: { types: {}, minScore: 0, countries: [], email: "immediate", browser: true, quietHours: { enabled: false, start: "22:00", end: "07:00", timezone: "UTC" } } as never }));
    await withTenant(ws, (tx) => tx.insert(schema.webhooks).values({ workspaceId: ws, url: "https://hooks.example/lo", events: ["lead.created"], minScore: 0, encryptedSecret: encryptSecret("whsec") }));
    setWebhookResolverForTests(async () => ["93.184.216.34"]);
    captureEmailsForTests(true);
  });
  afterAll(() => {
    setHttpClientForTests(null);
    setWebhookResolverForTests(null);
    captureEmailsForTests(false);
  });

  it("never schedules faster than the provider allows", () => {
    expect(intervalMinutes({ frequency: "custom", customIntervalMinutes: 15, providerIds: ["companies_house"] })).toBe(60);
    expect(intervalMinutes({ frequency: "manual", customIntervalMinutes: null, providerIds: ["osm"] })).toBeNull();
  });

  it("runs end to end with real-shaped provider data and prevents duplicates", async () => {
    const http = fakeHttp([
      { match: "advanced-search/companies", body: chSearch, headers: { "x-ratelimit-remain": "590" } },
      { match: "hooks.example", body: "ok" },
    ]);
    http.client; // eslint-friendly
    const original = http.client;
    setHttpClientForTests(async (url, req) => {
      if (url.includes("hooks.example")) hookCalls.push({ headers: req?.headers ?? {}, body: req?.body ?? "" });
      return original(url, req);
    });
    const outbox = captureEmailsForTests(true)!;
    const rule = await createRule(ws, userId, {
      name: "New UK companies in Leeds",
      providerIds: ["companies_house"],
      criteria: { countries: ["GB"], cities: ["Leeds"], industries: ["Construction"] },
      minScore: 30,
      contactRequirement: "none",
      autoAnalyzeWebsites: true,
      notify: true,
      frequency: "daily",
      customIntervalMinutes: null,
      active: true,
    });
    const tick = await schedulerTick(future());
    expect(tick.rulesQueued).toBe(1);
    expect((await schedulerTick(future())).rulesQueued).toBe(0); // slot already claimed
    await drain();

    const leads = await withTenant(ws, (tx) => tx.select({ lead: schema.leads, b: schema.businesses }).from(schema.leads).innerJoin(schema.businesses, eq(schema.businesses.id, schema.leads.businessId)));
    // Roofing matches target industry → qualifies; dental doesn't reach 30 without industry points.
    const names = leads.map((l) => l.b.name).sort();
    expect(names).toContain("NORTHSTAR ROOFING LTD");
    const roof = leads.find((l) => l.b.name === "NORTHSTAR ROOFING LTD")!;
    expect(roof.lead.discoveredByRuleId).toBe(rule.id);
    expect(roof.lead.discoveryProvider).toBe("companies_house");
    expect(roof.b.registrationDate).toBe("2026-10-20");
    expect(roof.b.registrationSource).toBe("companies_house");
    expect(roof.lead.score).toBeGreaterThanOrEqual(30);
    expect(roof.lead.scoreFactors.find((f) => f.key === "launch")!.points).toBe(15);

    const notes = await withTenant(ws, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.leadId, roof.lead.id)));
    expect(notes).toHaveLength(1);
    expect(notes[0].sourceUrl).toBe("https://find-and-update.company-information.service.gov.uk/company/15999001");
    expect(outbox.some((m) => m.subject.includes("NORTHSTAR ROOFING"))).toBe(true);

    expect(hookCalls.length).toBeGreaterThanOrEqual(1);
    const call = hookCalls[0];
    expect(call.headers["X-LeadOrbit-Signature"]).toBe(`sha256=${hmacSha256("whsec", `${call.headers["X-LeadOrbit-Timestamp"]}.${call.body}`)}`);
    expect(JSON.parse(call.body).business.name).toBe("NORTHSTAR ROOFING LTD");

    const [r] = await withTenant(ws, (tx) => tx.select().from(schema.monitoringRules).where(eq(schema.monitoringRules.id, rule.id)));
    expect(r.lastSuccessAt).toBeTruthy();
    expect(r.lastRunStats).toMatchObject({ fetched: 2 });
    const [integ] = await withTenant(ws, (tx) => tx.select().from(schema.integrations).where(eq(schema.integrations.providerId, "companies_house")));
    expect(integ.remainingQuota).toBe(590);

    // Second run: same companies → no new leads, no duplicate notifications.
    await systemDb().update(schema.monitoringRules).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(schema.monitoringRules.id, rule.id));
    await schedulerTick();
    await drain();
    const leads2 = await withTenant(ws, (tx) => tx.select().from(schema.leads));
    expect(leads2).toHaveLength(leads.length);
    const notes2 = await withTenant(ws, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.leadId, roof.lead.id)));
    expect(notes2).toHaveLength(1);
  });

  it("retries failed jobs with backoff, then marks them dead and notifies", async () => {
    setHttpClientForTests(fakeHttp([{ match: "advanced-search", status: 503, body: "unavailable" }]).client);
    const rule = await createRule(ws, userId, { name: "Flaky", providerIds: ["companies_house"], criteria: {}, minScore: 0, contactRequirement: "none", autoAnalyzeWebsites: false, notify: true, frequency: "daily", customIntervalMinutes: null, active: true });
    await systemDb().update(schema.monitoringRules).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(schema.monitoringRules.id, rule.id));
    await schedulerTick();
    await runJobs({ workerId: "test", budgetMs: 15_000, types: ["discovery_run"] });
    const [job] = await systemDb().select().from(schema.jobs).where(and(eq(schema.jobs.workspaceId, ws), eq(schema.jobs.type, "discovery_run"), eq(schema.jobs.status, "queued")));
    expect(job.attempts).toBe(1);
    expect(job.lastError).toMatch(/HTTP 503/);
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(backoffMs(2)).toBe(120_000);
    // exhaust attempts
    for (let i = 0; i < 4; i++) {
      await systemDb().update(schema.jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(schema.jobs.id, job.id));
      await runJobs({ workerId: "test", budgetMs: 15_000, types: ["discovery_run"] });
    }
    const [dead] = await systemDb().select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(dead.status).toBe("dead");
    const fails = await withTenant(ws, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.type, "job_failed")));
    expect(fails.length).toBe(1);
    const [r] = await withTenant(ws, (tx) => tx.select().from(schema.monitoringRules).where(eq(schema.monitoringRules.id, rule.id)));
    expect(r.lastError).toMatch(/503/);
    // manual retry from the UI
    expect(await retryJob(ws, job.id)).toBe(true);
    const [again] = await systemDb().select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(again.status).toBe("queued");
  });
});
