import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, systemDb, withTenant } from "@/lib/db";
import { setHttpClientForTests } from "@/lib/services/integrations";
import { runJobs } from "@/lib/jobs/runner";
import { schedulerTick } from "@/lib/jobs/scheduler";
import { getConnectionDef, saveConnection, listConnections } from "@/lib/social/accounts";
import { hookScore, parseGenerated, LINK_TOKEN } from "@/lib/social/ai";
import { blueskyFacets, composeText, composeThread, withUtm, type PostContent } from "@/lib/social/publish";
import { rankTrends } from "@/lib/social/trends";
import { nextSlot, parseLocalDateTime, zonedParts } from "@/lib/social/schedule";
import { cardImageUrl, verifyCardSignature } from "@/lib/social/image";
import { DEFAULT_CONFIG, generateFromText, getAutopilot, getPost, listPosts, queuePublish, runScan, saveAutopilot, setSocialResolverForTests, unschedulePost, validateConfig } from "@/lib/social/service";
import { listComments, socialAnalytics, syncEngagement } from "@/lib/social/engage";
import { pollTelegram } from "@/lib/social/telegram";
import { fakeHttp, type Route } from "./helpers/fake-http";
import { makeUser } from "./helpers/db";

const aiJson = (hook: string) =>
  JSON.stringify({
    primaryKeyword: "web design clients",
    hooks: [hook, "3 web design mistakes that cost you clients", "Stop cold DMing. Do this instead"],
    body: `Most freelancers miss this.\n\nFull breakdown 👉 ${LINK_TOKEN}`,
    linkedin: `A pattern I keep seeing in web design.\n\nRead more: ${LINK_TOKEN}`,
    instagram: `Save this 📌\n\nTap the ${LINK_TOKEN}`,
    shortBody: `The fix takes 5 minutes 👉 ${LINK_TOKEN}`,
    thread: ["1/ First, look at new domains.", `2/ Then check broken SSL. Details: ${LINK_TOKEN}`],
    engagementComment: "What's your #1 client source?",
    hashtags: ["#webdesign", "freelance", "web design"],
    altText: "Web design clients checklist",
  });
const gemini = (hook: string) => ({ candidates: [{ content: { parts: [{ text: aiJson(hook) }] } }] });
const geminiReply = { candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: "Great question! Check our profile for the full guide 🙌", skip: false }) }] } }] };

const hn = {
  hits: [
    { objectID: "1", title: "Ask HN: How do web design freelancers find clients in 2026?", created_at: new Date(Date.now() - 3600_000).toISOString(), points: 120, num_comments: 80 },
    { objectID: "2", title: "Rust compiler internals", created_at: new Date().toISOString(), points: 500 },
  ],
};
const news = `<?xml version="1.0"?><rss><channel>
<item><title>Small businesses still lack websites, survey says (web design)</title><link>https://news.example/a</link><guid>a</guid><pubDate>${new Date(Date.now() - 7200_000).toUTCString()}</pubDate><description>Many local shops have no web design.</description></item>
</channel></rss>`;

let recordN = 0;
const baseRoutes = (): Route[] => [
  { match: "hn.algolia.com", body: hn },
  { match: "news.google.com", body: news },
  { match: "generativelanguage.googleapis.com", body: gemini("Nobody tells web design freelancers this 👀") },
  { match: "/feed", body: { id: "page_1" } },
  { match: "/photos", body: { id: "photo_1", post_id: "page_1" } },
  { match: "createSession", body: { accessJwt: "jwt", did: "did:plc:abc", handle: "brand.bsky.social" } },
  { match: "createRecord", body: { uri: `at://did:plc:abc/app.bsky.feed.post/3kxyz${recordN++}`, cid: "bafycid" } },
];

describe("social autopilot: pure helpers", () => {
  it("parses model JSON, ranks hooks and strips the hook from texts", () => {
    const g = parseGenerated('Sure!\n```json\n{"hook":"H","body":"H\\n\\nBody text","shortBody":"Short","engagementComment":"Q?","hashtags":["#a","b c","a"]}\n```');
    expect(g.hooks).toEqual(["H"]);
    expect(g.body.startsWith("Body text")).toBe(true);
    expect(g.body).toContain(LINK_TOKEN);
    expect(g.hashtags).toEqual(["a", "bc"]);
    const full = parseGenerated(aiJson("ok"), ["web design"]);
    expect(full.hooks[0]).toBe("3 web design mistakes that cost you clients");
    expect(full.platformTexts.linkedin).toContain(LINK_TOKEN);
    expect(full.thread).toHaveLength(2);
    expect(() => parseGenerated("no json here")).toThrow(/JSON/);
    expect(() => parseGenerated('{"hooks":["x"]}')).toThrow(/missing fields/);
  });

  it("scores curiosity hooks above flat ones", () => {
    expect(hookScore("Nobody tells you these 3 web design secrets…", ["web design"])).toBeGreaterThan(hookScore("Web design update", ["web design"]));
    expect(hookScore("x".repeat(150))).toBeLessThan(40);
  });

  it("composes per-platform text with hook, UTM link and hashtags", () => {
    const c: PostContent = { hook: "Big hook", body: `Read 👉 ${LINK_TOKEN}`, shortBody: `Short 👉 ${LINK_TOKEN}`, platformTexts: { linkedin: `Pro text ${LINK_TOKEN}` }, hashtags: ["webdesign", "seo", "freelance", "agency"], imageUrl: null, link: "https://x.test/p", utm: true };
    const fb = composeText("facebook", c);
    expect(fb.startsWith("Big hook\n\nRead 👉 https://x.test/p?utm_source=facebook&utm_medium=social&utm_campaign=autopilot")).toBe(true);
    expect(fb).toContain("#webdesign #seo #freelance");
    expect(composeText("linkedin", c)).toContain("Pro text https://x.test/p?utm_source=linkedin");
    expect(composeText("instagram", c)).toContain("link in bio");
    expect(composeText("instagram", c)).toContain("#agency");
    expect(composeText("bluesky", c)).toBe("Big hook\n\nShort 👉 https://x.test/p?utm_source=bluesky&utm_medium=social&utm_campaign=autopilot\n\n#webdesign #seo");
    expect(composeText("discord", c)).not.toContain("#");
    expect(composeText("facebook", { ...c, link: "" })).not.toContain(LINK_TOKEN);
    expect(composeText("facebook", { ...c, body: `Big hook\n\nalready ${LINK_TOKEN}` }).match(/Big hook/g)).toHaveLength(1);
    const long = composeText("bluesky", { ...c, utm: false, shortBody: `${"word ".repeat(100)}👉 ${LINK_TOKEN}` });
    expect(Array.from(long).length).toBeLessThanOrEqual(300);
    expect(long.endsWith("https://x.test/p")).toBe(true);
    expect(composeThread("bluesky", { ...c, threadMode: true, thread: [`a ${LINK_TOKEN}`] })[0]).toContain("utm_source=bluesky");
    expect(composeThread("bluesky", { ...c, threadMode: false, thread: ["a"] })).toEqual([]);
    expect(withUtm("https://x.test/?utm_source=keep", "facebook")).toContain("utm_source=keep");
  });

  it("builds Bluesky link and hashtag facets with UTF-8 byte offsets", () => {
    const text = "👀 go https://a.test/x now #webdesign";
    const facets = blueskyFacets(text) as { index: { byteStart: number; byteEnd: number } }[];
    const bytes = new TextEncoder().encode(text);
    expect(facets.map((f) => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd)))).toEqual(["https://a.test/x", "#webdesign"]);
  });

  it("finds the next free posting slot in the workspace time zone", () => {
    // 2026-11-02 08:00 in Dhaka (UTC+6) = 02:00Z
    const after = new Date("2026-11-02T02:00:00Z");
    const first = nextSlot(["09:00", "20:00"], "Asia/Dhaka", after, []);
    expect(first.toISOString()).toBe("2026-11-02T03:00:00.000Z");
    const second = nextSlot(["09:00", "20:00"], "Asia/Dhaka", after, [first]);
    expect(second.toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(nextSlot([], "Asia/Dhaka", after, [])).toBe(after);
    // DST: 09:00 in New York on 2026-11-02 (after the switch to EST, UTC-5)
    expect(nextSlot(["09:00"], "America/New_York", new Date("2026-11-02T00:00:00Z"), []).toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(parseLocalDateTime("2026-11-05T20:30", "Asia/Dhaka")!.toISOString()).toBe("2026-11-05T14:30:00.000Z");
    expect(zonedParts(new Date("2026-11-02T03:00:00Z"), "Asia/Dhaka").hour).toBe(9);
  });

  it("signs image card URLs", () => {
    const id = "6b19d9b4-a1e1-437c-b436-f4baa20891af";
    const sig = new URL(cardImageUrl(id, { absolute: true })).searchParams.get("sig")!;
    expect(verifyCardSignature(id, sig)).toBe(true);
    expect(verifyCardSignature("6b19d9b4-a1e1-437c-b436-f4baa20891aa", sig)).toBe(false);
  });

  it("ranks only recent keyword matches", () => {
    const now = new Date();
    const since = new Date(now.getTime() - 2 * 86400_000);
    const items = [
      { sourceId: "x", externalId: "1", title: "web design tips", summary: null, url: null, publishedAt: now, engagement: 5 },
      { sourceId: "x", externalId: "2", title: "cooking", summary: null, url: null, publishedAt: now, engagement: 500 },
      { sourceId: "x", externalId: "3", title: "old web design", summary: null, url: null, publishedAt: new Date(since.getTime() - 1000), engagement: 1 },
    ];
    expect(rankTrends(items, ["Web Design"], now, since).map((i) => i.externalId)).toEqual(["1"]);
  });

  it("validates config", () => {
    expect(validateConfig(DEFAULT_CONFIG, true)).toEqual(expect.arrayContaining(["Add at least one niche keyword", "Choose at least one platform"]));
    expect(validateConfig({ ...DEFAULT_CONFIG, platforms: ["x_twitter"] }, false)).toContain("Unknown platform");
    expect(validateConfig({ ...DEFAULT_CONFIG, timezone: "Mars/Base" }, false)[0]).toMatch(/time zone/);
  });
});

describe("social autopilot: scan, schedule, publish, engage", () => {
  let ws: string, other: string;
  const cfg = { ...DEFAULT_CONFIG, keywords: ["web design"], sources: ["hackernews", "google_news"], platforms: ["facebook", "bluesky"], link: "https://brand.test", brandName: "Brand", scheduleMode: "immediate" as const, autoImage: false, utm: false, threadMode: false };
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
    expect(views.find((v) => v.id === "facebook")!.configured).toBe(true);
    expect(JSON.stringify(views)).not.toContain("fb-token");
  });

  it("approval mode: scan drafts SEO posts with hook variants from matching trends only, once", async () => {
    const http = fakeHttp(baseRoutes());
    setHttpClientForTests(http.client);
    await saveAutopilot(ws, { active: true, intervalMinutes: 60, config: cfg });
    const r = await runScan(ws);
    expect(r.errorMessages).toEqual([]);
    expect(r.drafted).toBe(2);
    const prompt = http.calls.find((c) => c.url.includes("generativelanguage"))!.body!;
    expect(prompt).toContain("never copy its sentences");
    expect(prompt).toContain("primaryKeyword");
    const drafts = await listPosts(ws, "review");
    expect(drafts).toHaveLength(2);
    expect(drafts[0].hookVariants).toHaveLength(3);
    expect(drafts[0].primaryKeyword).toBe("web design clients");
    expect(drafts[0].hashtags).toEqual(["webdesign", "freelance"]);
    expect((await runScan(ws)).drafted).toBe(0);
    expect(await listPosts(other, undefined)).toHaveLength(0); // RLS
  });

  it("publishes with rotated hooks per platform", async () => {
    const http = fakeHttp(baseRoutes());
    setHttpClientForTests(http.client);
    const ap = await getAutopilot(ws);
    await saveAutopilot(ws, { active: true, intervalMinutes: 60, config: { ...ap.config, rotateHooks: true } });
    const [post] = await listPosts(ws, "review");
    await queuePublish(ws, post.id, { when: "now" });
    await runJobs({ workerId: "t", budgetMs: 10_000, types: ["social_publish"] });
    const done = await getPost(ws, post.id);
    expect(done.status).toBe("published");
    expect(done.results.facebook).toMatchObject({ ok: true, url: "https://www.facebook.com/page_1", hookIndex: 0 });
    expect(done.results.bluesky).toMatchObject({ ok: true, hookIndex: 1, cid: "bafycid" });
    const fbMsg = new URLSearchParams(http.calls.find((c) => c.url.includes("/feed"))!.body).get("message")!;
    const bsText = JSON.parse(http.calls.find((c) => c.url.includes("createRecord"))!.body!).record.text as string;
    expect(fbMsg.startsWith(post.hookVariants[0])).toBe(true);
    expect(bsText.startsWith(post.hookVariants[1])).toBe(true);
    expect(fbMsg).toContain("https://brand.test");
  });

  it("schedules into posting slots, reschedules and unschedules without double jobs", async () => {
    const ap = await getAutopilot(ws);
    await saveAutopilot(ws, { active: true, intervalMinutes: 60, config: { ...ap.config, scheduleMode: "slots", postingTimes: ["09:00", "20:00"], timezone: "Asia/Dhaka" } });
    const p = await generateFromText(ws, { text: "Why most small business websites lose customers", platforms: ["facebook"] }).catch(async () => {
      setHttpClientForTests(fakeHttp(baseRoutes()).client);
      return generateFromText(ws, { text: "Why most small business websites lose customers", platforms: ["facebook"] });
    });
    const at = await queuePublish(ws, p.id, { when: "slot" });
    expect(zonedParts(at, "Asia/Dhaka").minute).toBe(0);
    expect([9, 20]).toContain(zonedParts(at, "Asia/Dhaka").hour);
    const later = new Date(at.getTime() + 86400_000);
    await queuePublish(ws, p.id, { when: later });
    const jobs = await systemDb().select().from(schema.jobs).where(and(eq(schema.jobs.type, "social_publish"), eq(schema.jobs.status, "queued")));
    const mine = jobs.filter((j) => (j.payload as { postId: string }).postId === p.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].runAt.getTime()).toBe(later.getTime());
    // A stale job for the old time is skipped by the handler.
    const { publishPost } = await import("@/lib/social/service");
    expect(await publishPost(ws, p.id)).toMatchObject({ skipped: true, reason: "rescheduled" });
    await unschedulePost(ws, p.id);
    expect((await getPost(ws, p.id)).status).toBe("draft");
  });

  it("retries only the platforms that failed", async () => {
    await saveAutopilot(ws, { active: true, intervalMinutes: 60, config: { ...cfg, rotateHooks: false } });
    const post = (await listPosts(ws, "review")).find((p) => p.platforms.length === 2)!;
    setHttpClientForTests(fakeHttp([{ match: "/feed", body: { id: "page_2" } }, { match: "createSession", status: 401, body: { error: "AuthenticationRequired" } }]).client);
    await queuePublish(ws, post.id, { when: "now" });
    await runJobs({ workerId: "t", budgetMs: 10_000, types: ["social_publish"] });
    let row = await getPost(ws, post.id);
    expect(row.results.facebook.ok).toBe(true);
    expect(row.status).toBe("partial");
    const http = fakeHttp(baseRoutes());
    setHttpClientForTests(http.client);
    await queuePublish(ws, post.id, { when: "now" });
    await runJobs({ workerId: "t", budgetMs: 10_000, types: ["social_publish"] });
    row = await getPost(ws, post.id);
    expect(row.status).toBe("published");
    expect(http.calls.some((c) => c.url.includes("/feed"))).toBe(false);
  });

  it("collects comments, drafts AI replies, sends them and refreshes metrics", async () => {
    const [published] = await listPosts(ws, "published");
    const fbId = published.results.facebook.id!;
    const bsUri = published.results.bluesky.id!;
    const http = fakeHttp([
      { match: `${fbId}/comments?filter`, body: { data: [{ id: "c1", message: "How do you find these leads?", created_time: new Date().toISOString(), from: { id: "u1", name: "Ana" } }, { id: "c2", message: "own", from: { id: "123" } }] } },
      { match: "getPostThread", body: { thread: { replies: [{ post: { uri: "at://did:plc:zzz/app.bsky.feed.post/r1", cid: "rcid", author: { did: "did:plc:zzz", handle: "bob.bsky.social" }, record: { text: "Love this", createdAt: new Date().toISOString() } } }] } } },
      { match: "generativelanguage", body: geminiReply },
      { match: "c1/comments", body: { id: "reply_1" } },
      { match: "createSession", body: { accessJwt: "jwt", did: "did:plc:abc", handle: "brand.bsky.social" } },
      { match: "createRecord", body: { uri: "at://did:plc:abc/app.bsky.feed.post/reply", cid: "x" } },
      { match: "fields=shares", body: { shares: { count: 2 }, reactions: { summary: { total_count: 10 } }, comments: { summary: { total_count: 1 } } } },
      { match: "getPosts", body: { posts: [{ likeCount: 4, replyCount: 1, repostCount: 1 }] } },
      { match: /graph\.facebook\.com.*\/comments/, body: { data: [] } },
      { match: "getPostThread", body: { thread: { replies: [] } } },
    ]);
    setHttpClientForTests(http.client);
    const ap = await getAutopilot(ws);
    await saveAutopilot(ws, { active: true, intervalMinutes: 60, config: { ...ap.config, autoReply: "auto", maxRepliesPerDay: 5 } });
    const r = await syncEngagement(ws);
    expect(r.newComments).toBeGreaterThanOrEqual(2);
    expect(r.replied).toBe(r.drafted);
    const replied = await listComments(ws, "replied");
    expect(replied.map((x) => x.c.platform).sort()).toEqual(["bluesky", "facebook"]);
    const bsReply = JSON.parse(http.calls.find((c) => c.url.includes("createRecord"))!.body!);
    expect(bsReply.record.reply.parent).toEqual({ uri: "at://did:plc:zzz/app.bsky.feed.post/r1", cid: "rcid" });
    const publishedUris = (await listPosts(ws, "published")).map((p) => p.results.bluesky?.id);
    expect(publishedUris).toContain(bsReply.record.reply.root.uri);
    expect(bsUri).toBeTruthy();
    const again = await syncEngagement(ws);
    expect(again.newComments).toBe(0); // dedupe
    const withMetrics = await getPost(ws, published.id);
    expect(withMetrics.results.facebook.metrics).toEqual({ likes: 10, comments: 1, shares: 2 });
    const a = await socialAnalytics(ws, 7, "Asia/Dhaka");
    expect(a.totals.engagement).toBeGreaterThan(0);
    expect(a.platforms[0].label).toBeTruthy();
    expect(a.totals.repliesSent).toBe(2);
  });

  it("Telegram approvals: buttons from the approver act, strangers are ignored", async () => {
    const ap = await getAutopilot(ws);
    await saveAutopilot(ws, { active: true, intervalMinutes: 60, config: { ...ap.config, scheduleMode: "immediate" } });
    await saveConnection(ws, getConnectionDef("platform", "telegram")!, { enabled: true, settings: { chatId: "", approverChatId: "777" }, secrets: { botToken: "bot-token" } });
    setHttpClientForTests(fakeHttp(baseRoutes()).client);
    await generateFromText(ws, { text: "Your website is losing you customers", platforms: ["facebook"] });
    const draft = (await listPosts(ws, "review"))[0];
    const other = (await listPosts(ws, "review"))[1];
    setHttpClientForTests(
      fakeHttp([
        {
          match: "getUpdates",
          body: {
            ok: true,
            result: [
              { update_id: 10, callback_query: { id: "q1", from: { id: 999 }, data: `p:r:${other.id}` } },
              { update_id: 11, callback_query: { id: "q2", from: { id: 777 }, data: `p:n:${draft.id}`, message: { message_id: 5, chat: { id: 777 } } } },
            ],
          },
        },
        { match: "api.telegram.org", body: { ok: true, result: true } },
      ]).client,
    );
    const r = await pollTelegram(ws);
    expect(r).toMatchObject({ updates: 2, handled: 1 });
    expect((await getPost(ws, draft.id)).status).toBe("queued");
    expect((await getPost(ws, other.id)).status).toBe("draft");
    const [row] = await withTenant(ws, (tx) => tx.select().from(schema.socialAutopilots).where(eq(schema.socialAutopilots.workspaceId, ws)));
    expect(row.telegramOffset).toBe(12);
  });

  it("scheduler enqueues scans, engagement and telegram polls when due", async () => {
    await systemDb().update(schema.socialAutopilots).set({ nextRunAt: new Date(Date.now() - 1000), engageSyncedAt: null }).where(eq(schema.socialAutopilots.workspaceId, ws));
    const tick = await schedulerTick();
    expect(tick.socialScans).toBe(1);
    expect((await schedulerTick()).socialScans).toBe(0);
    const jobs = await systemDb().select().from(schema.jobs).where(and(eq(schema.jobs.workspaceId, ws), eq(schema.jobs.status, "queued")));
    expect(jobs.map((j) => j.type)).toEqual(expect.arrayContaining(["social_scan", "social_engage", "social_telegram_poll"]));
  });

  it("generates a draft from pasted text", async () => {
    setHttpClientForTests(fakeHttp(baseRoutes()).client);
    const p = await generateFromText(ws, { text: "Finding clients as a freelance web dev is exhausting.", platforms: ["facebook"] });
    expect(p.status).toBe("draft");
    expect(p.sourceId).toBe("manual");
    await expect(generateFromText(other, { text: "hello there" })).rejects.toThrow(/not configured/);
  });
});
