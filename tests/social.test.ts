import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, systemDb, withTenant } from "@/lib/db";
import { setHttpClientForTests } from "@/lib/services/integrations";
import { runJobs } from "@/lib/jobs/runner";
import { schedulerTick } from "@/lib/jobs/scheduler";
import { getConnectionDef, saveConnection, listConnections } from "@/lib/social/accounts";
import { parseGenerated, LINK_TOKEN } from "@/lib/social/ai";
import { blueskyFacets, composeText } from "@/lib/social/publish";
import { rankTrends } from "@/lib/social/trends";
import { DEFAULT_CONFIG, generateFromText, getAutopilot, listPosts, queuePublish, runScan, saveAutopilot, setSocialResolverForTests, validateConfig } from "@/lib/social/service";
import { fakeHttp, type Route } from "./helpers/fake-http";
import { makeUser } from "./helpers/db";

const gemini = (hook: string) => ({
  candidates: [
    {
      content: {
        parts: [{ text: JSON.stringify({ hook, body: `${hook}\n\nMost freelancers miss this.\n\nSee how 👉 ${LINK_TOKEN}`, shortBody: `${hook} 👉 ${LINK_TOKEN}`, engagementComment: "What's your #1 client source?", hashtags: ["#webdesign", "freelance"] }) }],
      },
    },
  ],
});

const hn = {
  hits: [
    { objectID: "1", title: "Ask HN: How do web design freelancers find clients in 2026?", created_at: new Date(Date.now() - 3600_000).toISOString(), points: 120, num_comments: 80 },
    { objectID: "2", title: "Rust compiler internals", created_at: new Date().toISOString(), points: 500 },
  ],
};

const news = `<?xml version="1.0"?><rss><channel>
<item><title>Small businesses still lack websites, survey says (web design)</title><link>https://news.example/a</link><guid>a</guid><pubDate>${new Date(Date.now() - 7200_000).toUTCString()}</pubDate><description>Many local shops have no web design.</description></item>
</channel></rss>`;

const baseRoutes: Route[] = [
  { match: "hn.algolia.com", body: hn },
  { match: "news.google.com", body: news },
  { match: "generativelanguage.googleapis.com", body: gemini("Nobody tells freelancers this 👀") },
  { match: "/feed", body: { id: "page_1" } },
  { match: "createSession", body: { accessJwt: "jwt", did: "did:plc:abc", handle: "brand.bsky.social" } },
  { match: "createRecord", body: { uri: "at://did:plc:abc/app.bsky.feed.post/3kxyz" } },
];

describe("social autopilot: pure helpers", () => {
  it("parses model JSON with fences and adds a missing link token", () => {
    const g = parseGenerated('Sure!\n```json\n{"hook":"H","body":"Body text","shortBody":"Short","engagementComment":"Q?","hashtags":["#a","b c"]}\n```');
    expect(g.body).toContain(LINK_TOKEN);
    expect(g.shortBody).toContain(LINK_TOKEN);
    expect(g.hashtags).toEqual(["a", "bc"]);
    expect(() => parseGenerated("no json here")).toThrow(/JSON/);
    expect(() => parseGenerated('{"hook":"x"}')).toThrow(/missing fields/);
  });

  it("composes per-platform text", () => {
    const c = { body: `Big hook\n\nRead 👉 ${LINK_TOKEN}`, shortBody: `Short hook 👉 ${LINK_TOKEN}`, hashtags: ["webdesign"], imageUrl: null, link: "https://x.test/p" };
    expect(composeText("facebook", c)).toBe("Big hook\n\nRead 👉 https://x.test/p\n\n#webdesign");
    expect(composeText("instagram", c)).toContain("link in bio");
    expect(composeText("bluesky", c)).toBe("Short hook 👉 https://x.test/p\n\n#webdesign");
    expect(composeText("discord", c)).not.toContain("#webdesign");
    expect(composeText("facebook", { ...c, link: "" })).not.toContain(LINK_TOKEN);
    const long = composeText("bluesky", { ...c, shortBody: `${"word ".repeat(100)}👉 ${LINK_TOKEN}` });
    expect(Array.from(long).length).toBeLessThanOrEqual(300);
    expect(long.endsWith("https://x.test/p")).toBe(true);
  });

  it("builds Bluesky link facets with UTF-8 byte offsets", () => {
    const text = "👀 go https://a.test/x now";
    const [f] = blueskyFacets(text) as { index: { byteStart: number; byteEnd: number } }[];
    const bytes = new TextEncoder().encode(text);
    expect(new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd))).toBe("https://a.test/x");
  });

  it("ranks only recent keyword matches", () => {
    const now = new Date();
    const since = new Date(now.getTime() - 2 * 86400_000);
    const items = [
      { sourceId: "x", externalId: "1", title: "web design tips", summary: null, url: null, publishedAt: now, engagement: 5 },
      { sourceId: "x", externalId: "2", title: "cooking", summary: null, url: null, publishedAt: now, engagement: 500 },
      { sourceId: "x", externalId: "3", title: "old web design", summary: null, url: null, publishedAt: new Date(since.getTime() - 1000), engagement: 1 },
      { sourceId: "x", externalId: "1", title: "web design tips", summary: null, url: null, publishedAt: now, engagement: 5 },
    ];
    expect(rankTrends(items, ["Web Design"], now, since).map((i) => i.externalId)).toEqual(["1"]);
  });

  it("validates config before activation", () => {
    expect(validateConfig(DEFAULT_CONFIG, true)).toEqual(expect.arrayContaining(["Add at least one niche keyword", "Choose at least one platform"]));
    expect(validateConfig({ ...DEFAULT_CONFIG, platforms: ["x_twitter"] }, false)).toContain("Unknown platform");
  });
});

describe("social autopilot: scan and publish", () => {
  let ws: string, other: string;
  beforeAll(async () => {
    ws = (await makeUser("Social")).workspace.id;
    other = (await makeUser("Other social")).workspace.id;
    await systemDb().update(schema.jobs).set({ status: "cancelled" });
    setSocialResolverForTests(async () => ["93.184.216.34"]);
    await saveConnection(ws, getConnectionDef("ai", "gemini")!, { enabled: true, settings: { model: "" }, secrets: { apiKey: "gem-key" } });
    await saveConnection(ws, getConnectionDef("platform", "facebook")!, { enabled: true, settings: { pageId: "123" }, secrets: { accessToken: "fb-token" } });
    await saveConnection(ws, getConnectionDef("platform", "bluesky")!, { enabled: true, settings: { handle: "brand.bsky.social" }, secrets: { appPassword: "app-pw" } });
  });
  afterAll(() => {
    setHttpClientForTests(null);
    setSocialResolverForTests(null);
  });

  it("never exposes raw secrets", async () => {
    const views = await listConnections(ws);
    const fb = views.find((v) => v.id === "facebook")!;
    expect(fb.configured).toBe(true);
    expect(JSON.stringify(views)).not.toContain("fb-token");
  });

  it("approval mode: scan drafts posts from matching trends only, once", async () => {
    const http = fakeHttp(baseRoutes);
    setHttpClientForTests(http.client);
    await saveAutopilot(ws, { active: true, intervalMinutes: 60, config: { ...DEFAULT_CONFIG, keywords: ["web design"], sources: ["hackernews", "google_news"], platforms: ["facebook", "bluesky"], link: "https://brand.test", brandName: "Brand" } });
    const r = await runScan(ws);
    expect(r.errorMessages).toEqual([]);
    expect(r.drafted).toBe(2);
    expect(r.queued).toBe(0);
    const gemCall = http.calls.find((c) => c.url.includes("generativelanguage"))!;
    expect(gemCall.body).toContain("never copy its sentences");
    const drafts = await listPosts(ws, "review");
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.platforms.join() === "facebook,bluesky")).toBe(true);
    expect((await runScan(ws)).drafted).toBe(0); // same trends are not drafted twice
    expect(await listPosts(other, undefined)).toHaveLength(0); // RLS
  });

  it("publishes an approved post to every platform with links", async () => {
    const http = fakeHttp(baseRoutes);
    setHttpClientForTests(http.client);
    const [post] = await listPosts(ws, "review");
    await queuePublish(ws, post.id);
    await runJobs({ workerId: "t", budgetMs: 10_000, types: ["social_publish"] });
    const [done] = await withTenant(ws, (tx) => tx.select().from(schema.socialPosts).where(eq(schema.socialPosts.id, post.id)));
    expect(done.status).toBe("published");
    expect(done.results.facebook).toMatchObject({ ok: true, url: "https://www.facebook.com/page_1" });
    expect(done.results.bluesky).toMatchObject({ ok: true, url: "https://bsky.app/profile/brand.bsky.social/post/3kxyz" });
    const fb = http.calls.find((c) => c.url.includes("/feed"))!;
    const fbBody = new URLSearchParams(fb.body);
    expect(fbBody.get("message")).toContain("https://brand.test");
    expect(fbBody.get("access_token")).toBe("fb-token");
    const bs = JSON.parse(http.calls.find((c) => c.url.includes("createRecord"))!.body!);
    expect(bs.record.text).toContain("https://brand.test");
    expect(bs.record.facets).toHaveLength(1);
  });

  it("retries only the platforms that failed", async () => {
    const [post] = await listPosts(ws, "review");
    setHttpClientForTests(fakeHttp([{ match: "/feed", body: { id: "page_2" } }, { match: "createSession", status: 401, body: { error: "AuthenticationRequired" } }]).client);
    await queuePublish(ws, post.id);
    await runJobs({ workerId: "t", budgetMs: 10_000, types: ["social_publish"] });
    let [row] = await withTenant(ws, (tx) => tx.select().from(schema.socialPosts).where(eq(schema.socialPosts.id, post.id)));
    expect(row.results.facebook.ok).toBe(true);
    expect(row.results.bluesky.ok).toBe(false);
    expect(row.status).toBe("partial");
    const http = fakeHttp(baseRoutes);
    setHttpClientForTests(http.client);
    await queuePublish(ws, post.id);
    await runJobs({ workerId: "t", budgetMs: 10_000, types: ["social_publish"] });
    [row] = await withTenant(ws, (tx) => tx.select().from(schema.socialPosts).where(eq(schema.socialPosts.id, post.id)));
    expect(row.status).toBe("published");
    expect(http.calls.some((c) => c.url.includes("/feed"))).toBe(false); // no double post
  });

  it("auto mode queues posts and respects the daily limit", async () => {
    await withTenant(ws, (tx) => tx.delete(schema.socialPosts).where(eq(schema.socialPosts.workspaceId, ws)));
    setHttpClientForTests(fakeHttp(baseRoutes).client);
    const ap = await getAutopilot(ws);
    await saveAutopilot(ws, { active: true, intervalMinutes: 60, config: { ...ap.config, mode: "auto", maxPostsPerDay: 1 } });
    const r = await runScan(ws);
    expect(r.queued).toBe(1);
    expect(r.skippedDailyLimit).toBe(1);
    await runJobs({ workerId: "t", budgetMs: 10_000, types: ["social_publish"] });
    expect(await listPosts(ws, "published")).toHaveLength(1);
  });

  it("scheduler enqueues a scan when the autopilot is due", async () => {
    await systemDb().update(schema.socialAutopilots).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(schema.socialAutopilots.workspaceId, ws));
    const tick = await schedulerTick();
    expect(tick.socialScans).toBe(1);
    expect((await schedulerTick()).socialScans).toBe(0);
    const jobs = await systemDb().select().from(schema.jobs).where(and(eq(schema.jobs.workspaceId, ws), eq(schema.jobs.type, "social_scan")));
    expect(jobs).toHaveLength(1);
  });

  it("generates a draft from pasted text", async () => {
    setHttpClientForTests(fakeHttp(baseRoutes).client);
    const p = await generateFromText(ws, { text: "Finding clients as a freelance web dev is exhausting.", platforms: ["facebook"] });
    expect(p.status).toBe("draft");
    expect(p.sourceId).toBe("manual");
    expect(p.hashtags).toEqual(["webdesign", "freelance"]);
    await expect(generateFromText(other, { text: "hello there" })).rejects.toThrow(/not configured/);
  });
});
