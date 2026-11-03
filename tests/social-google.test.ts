import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { setHttpClientForTests } from "@/lib/services/integrations";
import { GOOGLE_ACCOUNT, getConnection, getConnectionDef, listConnections, saveConnection } from "@/lib/social/accounts";
import { googleAuthFinish, googleAuthStart, signGoogleState, verifyGoogleState } from "@/lib/social/google";
import { clearGoogleTokenCache } from "@/lib/social/publish-more";
import { syncSeo } from "@/lib/social/engage";
import { createComposerPost, DEFAULT_CONFIG, getAutopilot, publishNow, runScan, saveAutopilot, seoKeywords, setSocialResolverForTests } from "@/lib/social/service";
import { fakeHttp } from "./helpers/fake-http";
import { makeUser } from "./helpers/db";

const geminiPost = { candidates: [{ content: { parts: [{ text: JSON.stringify({ primaryKeyword: "website speed", hooks: ["Your website is slow and you do not know it"], body: "b {LINK}", shortBody: "s {LINK}", hashtags: ["speed"] }) }] } }] };

describe("Sign in with Google", () => {
  let ws: string, userId: string;
  beforeAll(async () => {
    const u = await makeUser("Googler");
    ws = u.workspace.id;
    userId = u.user.id;
    setSocialResolverForTests(async () => ["93.184.216.34"]);
  });
  afterAll(() => {
    setHttpClientForTests(null);
    setSocialResolverForTests(null);
    clearGoogleTokenCache();
  });

  it("signs and verifies OAuth state bound to the browser nonce", () => {
    const s = signGoogleState(ws, userId, "nonce1");
    expect(verifyGoogleState(s, "nonce1")).toEqual({ workspaceId: ws, userId });
    expect(verifyGoogleState(s, "other")).toBeNull();
    expect(verifyGoogleState(`${s.split(".")[0]}.${"0".repeat(64)}`, "nonce1")).toBeNull();
    expect(verifyGoogleState(signGoogleState(ws, userId, "n", Date.now() - 3_600_000), "n")).toBeNull();
  });

  it("needs a client ID, then builds an offline consent URL with all scopes", async () => {
    await expect(googleAuthStart(ws, userId)).rejects.toThrow(/client ID/);
    await saveConnection(ws, GOOGLE_ACCOUNT, { enabled: true, settings: { searchConsoleSite: "sc-domain:brand.test", sitemapUrl: "https://brand.test/sitemap.xml", sheetsLog: "1" }, secrets: { clientId: "cid.apps.googleusercontent.com", clientSecret: "secret" } });
    const { url, nonce } = await googleAuthStart(ws, userId);
    const u = new URL(url);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/social/google/callback");
    expect(u.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/webmasters");
    expect(u.searchParams.get("scope")).toContain("drive.file");
    expect(verifyGoogleState(u.searchParams.get("state")!, nonce)?.workspaceId).toBe(ws);
  });

  it("stores the refresh token and shares it with Blogger, YouTube and Business Profile", async () => {
    setHttpClientForTests(
      fakeHttp([
        { match: "oauth2.googleapis.com/token", body: { access_token: "at", refresh_token: "shared-rt", scope: "openid email" } },
        { match: "openidconnect.googleapis.com/v1/userinfo", body: { email: "owner@brand.test" } },
      ]).client,
    );
    expect(await googleAuthFinish(ws, "auth-code")).toEqual({ email: "owner@brand.test" });
    await saveConnection(ws, getConnectionDef("platform", "blogger")!, { enabled: true, settings: { blogId: "77" }, secrets: {} });
    const blogger = await getConnection(ws, getConnectionDef("platform", "blogger")!);
    expect(blogger).toMatchObject({ configured: true, sharedGoogle: true });
    expect(blogger.secrets).toMatchObject({ refreshToken: "shared-rt", clientId: "cid.apps.googleusercontent.com" });
    const views = await listConnections(ws);
    expect(views.find((v) => v.id === "google")).toMatchObject({ configured: true, email: "owner@brand.test" });
    expect(JSON.stringify(views)).not.toContain("shared-rt");
  });

  it("pulls Search Console keyword opportunities and feeds them to the AI", async () => {
    clearGoogleTokenCache();
    setHttpClientForTests(
      fakeHttp([
        { match: "oauth2.googleapis.com/token", body: { access_token: "gt", expires_in: 3600 } },
        {
          match: "searchAnalytics/query",
          body: {
            rows: [
              { keys: ["website speed test"], clicks: 3, impressions: 900, ctr: 0.0033, position: 8.4 },
              { keys: ["brand name"], clicks: 80, impressions: 200, ctr: 0.4, position: 1.1 },
              { keys: ["rare query"], clicks: 0, impressions: 5, ctr: 0, position: 30 },
            ],
          },
        },
      ]).client,
    );
    const s = await syncSeo(ws);
    expect(s.site).toBe("sc-domain:brand.test");
    expect(s.opportunities.map((q) => q.query)).toEqual(["website speed test"]);
    expect(s.top[0].query).toBe("brand name");
    expect(await seoKeywords(ws)).toEqual(["website speed test", "brand name", "rare query"]);
    expect((await getAutopilot(ws)).seoInsights?.opportunities).toHaveLength(1);
  });

  it("uses YouTube as a trend source and puts Search Console keywords in the prompt", async () => {
    clearGoogleTokenCache();
    await saveConnection(ws, getConnectionDef("ai", "gemini")!, { enabled: true, settings: {}, secrets: { apiKey: "k" } });
    await saveAutopilot(ws, { active: false, intervalMinutes: 180, config: { ...DEFAULT_CONFIG, keywords: ["website"], sources: ["youtube"], platforms: [] } });
    const http = fakeHttp([
      { match: "oauth2.googleapis.com/token", body: { access_token: "gt", expires_in: 3600 } },
      { match: "youtube/v3/search", body: { items: [{ id: { videoId: "v1" }, snippet: { title: "Why your website is slow", description: "Speed tips", publishedAt: new Date().toISOString(), channelTitle: "Dev" } }] } },
      { match: "youtube/v3/videos", body: { items: [{ id: "v1", statistics: { viewCount: "50000", likeCount: "900", commentCount: "40" } }] } },
      { match: "generativelanguage", body: geminiPost },
    ]);
    setHttpClientForTests(http.client);
    const r = await runScan(ws);
    expect(r.errorMessages).toEqual([]);
    expect(r.drafted).toBe(1);
    const [post] = await withTenant(ws, (tx) => tx.select().from(schema.socialPosts).where(eq(schema.socialPosts.workspaceId, ws)));
    expect(post).toMatchObject({ sourceId: "youtube", sourceUrl: "https://www.youtube.com/watch?v=v1" });
    const prompt = http.calls.find((c) => c.url.includes("generativelanguage"))!.body!;
    expect(prompt).toContain("Search Console");
    expect(prompt).toContain("website speed test");
  });

  it("logs published posts to Google Sheets and resubmits the sitemap after blog posts", async () => {
    clearGoogleTokenCache();
    const http = fakeHttp([
      { match: "oauth2.googleapis.com/token", body: { access_token: "gt", expires_in: 3600 } },
      { match: "blogger/v3/blogs/77/posts", body: { id: "p1", url: "https://brand.blogspot.com/p1" } },
      { match: /sheets\.googleapis\.com\/v4\/spreadsheets$/, body: { spreadsheetId: "sheet1", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet1" } },
      { match: ":append", body: { updates: {} } },
      { match: "/sitemaps/", body: "" },
    ]);
    setHttpClientForTests(http.client);
    const p = await createComposerPost(ws, { title: "New guide", description: "d", content: "c", link: "https://brand.test/guide", hashtags: [], mediaIds: [], alts: [], platforms: ["blogger"] });
    const { post } = await publishNow(ws, p.id);
    expect(post.status).toBe("published");
    const appends = http.calls.filter((c) => c.url.includes(":append")).map((c) => JSON.parse(c.body!).values[0]);
    expect(appends[0][0]).toBe("Published"); // header row on the new sheet
    expect(appends[1]).toEqual(expect.arrayContaining(["New guide", "Blogger", "published", "Blogger: https://brand.blogspot.com/p1", "https://brand.test/guide"]));
    const sitemap = http.calls.find((c) => c.url.includes("/sitemaps/"))!;
    expect(sitemap.method).toBe("PUT");
    expect(sitemap.url).toContain(encodeURIComponent("https://brand.test/sitemap.xml"));
    expect((await getConnection(ws, GOOGLE_ACCOUNT)).secrets.spreadsheetId).toBe("sheet1");
  });
});
