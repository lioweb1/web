import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema, withTenant } from "@/lib/db";
import { setHttpClientForTests } from "@/lib/services/integrations";
import { getConnection, getConnectionDef, saveConnection } from "@/lib/social/accounts";
import { buildArticle, markdownToHtml } from "@/lib/social/article";
import { LINK_TOKEN, parseGenerated } from "@/lib/social/ai";
import { clearGoogleTokenCache } from "@/lib/social/publish-more";
import { saveUpload } from "@/lib/social/media";
import { buildSlideshow } from "@/lib/social/video";
import { createComposerPost, DEFAULT_CONFIG, getPost, prepareVideo, publishNow, saveAutopilot, setSocialResolverForTests, testConnection, updatePost } from "@/lib/social/service";
import { fakeHttp } from "./helpers/fake-http";
import { makeUser } from "./helpers/db";

const jpeg = (color: string) => sharp({ create: { width: 900, height: 900, channels: 3, background: color } }).jpeg().toBuffer();

describe("articles", () => {
  it("converts Markdown to safe HTML", () => {
    const html = markdownToHtml("## Why it matters\n\nSome **bold** and *em* text with a [link](https://x.test).\n\n- one\n- two\n\n1. first\n\n> quote\n\n<script>alert(1)</script>");
    expect(html).toContain("<h3>Why it matters</h3>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://x.test">link</a>');
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li></ol>");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("<script>");
  });

  it("builds an article with images, CTA, excerpt and canonical URL", () => {
    const a = buildArticle({ title: "Title", article: `## Intro\n\nBody text here.\n\nRead more 👉 ${LINK_TOKEN}`, body: "", metaDescription: "Meta text", hashtags: ["Web Design", "seo!", "x"], link: "https://site.test/post", images: [{ url: "https://img/1.jpg", alt: "One" }, { url: "https://img/2.jpg", alt: null }] });
    expect(a.markdown).toContain("Read more 👉 https://site.test/post");
    expect(a.markdown).toContain("![Title](https://img/2.jpg)");
    expect(a.html.startsWith('<p><img src="https://img/1.jpg" alt="One" /></p>')).toBe(true);
    expect(a).toMatchObject({ excerpt: "Meta text", tags: ["webdesign", "seo"], canonicalUrl: "https://site.test/post", coverUrl: "https://img/1.jpg" });
  });

  it("parses the AI article and meta description", () => {
    const g = parseGenerated(JSON.stringify({ hooks: ["H"], body: "b", shortBody: "s", article: "## A\n\ntext", metaDescription: "meta" }));
    expect(g.platformTexts).toMatchObject({ article: "## A\n\ntext", metaDescription: "meta" });
  });
});

describe("slideshow video", () => {
  it("renders a vertical H.264 MP4 with audio", async () => {
    const v = await buildSlideshow([await jpeg("#2563eb"), await jpeg("#16a34a")], { hook: "Hook text", cta: "Link in bio", brand: "Brand", brandColor: "#7c3aed", secondsPerSlide: 2 });
    expect(v.seconds).toBe(4);
    expect(v.data.subarray(4, 8).toString()).toBe("ftyp");
    expect(v.data.length).toBeGreaterThan(10_000);
  }, 120_000);
});

describe("new platforms", () => {
  let ws: string;
  beforeAll(async () => {
    ws = (await makeUser("Channels")).workspace.id;
    setSocialResolverForTests(async () => ["93.184.216.34"]);
    await saveAutopilot(ws, { active: false, intervalMinutes: 180, config: { ...DEFAULT_CONFIG, utm: false, brandName: "Brand", videoSecondsPerSlide: 1.5 } });
    const google = { clientId: "cid", clientSecret: "cs", refreshToken: "rt" };
    for (const [id, settings, secrets] of [
      ["pinterest", { boardId: "b1" }, { accessToken: "pin" }],
      ["google_business", { accountId: "11", locationId: "22" }, google],
      ["wordpress", { siteUrl: "https://blog.example", username: "admin", status: "" }, { appPassword: "abcd efgh" }],
      ["blogger", { blogId: "77" }, google],
      ["devto", {}, { apiKey: "dev" }],
      ["hashnode", { publicationId: "pub1" }, { token: "hn" }],
      ["youtube", { privacy: "" }, google],
      ["tiktok", { privacy: "PUBLIC_TO_EVERYONE" }, { clientKey: "ck", clientSecret: "cs", refreshToken: "tt-old" }],
    ] as const)
      await saveConnection(ws, getConnectionDef("platform", id)!, { enabled: true, settings: { ...settings }, secrets: { ...secrets } });
  });
  afterAll(() => {
    setHttpClientForTests(null);
    setSocialResolverForTests(null);
    clearGoogleTokenCache();
  });

  it("publishes one composer post to all eight platforms", async () => {
    clearGoogleTokenCache();
    const a = await saveUpload(ws, { bytes: await jpeg("#ef4444"), type: "image/jpeg" });
    const b = await saveUpload(ws, { bytes: await jpeg("#22c55e"), type: "image/jpeg" });
    const http = fakeHttp([
      { match: "api.pinterest.com/v5/pins", body: { id: "pin123" } },
      { match: "oauth2.googleapis.com/token", body: { access_token: "gtoken", expires_in: 3600 } },
      { match: "localPosts", body: { name: "accounts/11/locations/22/localPosts/9", searchUrl: "https://g.page/post" } },
      { match: "/wp-json/wp/v2/media/", body: { id: 5 } },
      { match: "/wp-json/wp/v2/media", body: { id: 5, source_url: "https://blog.example/wp-content/a.jpg" } },
      { match: "/wp-json/wp/v2/tags?search", body: [] },
      { match: "/wp-json/wp/v2/tags", body: { id: 31 } },
      { match: "/wp-json/wp/v2/posts", body: { id: 101, link: "https://blog.example/news" } },
      { match: "blogger/v3/blogs/77/posts", body: { id: "bp1", url: "https://brand.blogspot.com/p" } },
      { match: "dev.to/api/articles", body: { id: 42, url: "https://dev.to/brand/news" } },
      { match: "gql.hashnode.com", body: { data: { publishPost: { post: { id: "h1", url: "https://brand.hashnode.dev/news" } } } } },
      { match: "upload/youtube/v3/videos", body: {}, headers: { location: "https://upload.youtube.test/session1" } },
      { match: "upload.youtube.test/session1", body: { id: "yt999" } },
      { match: "open.tiktokapis.com/v2/oauth/token", body: { access_token: "tta", refresh_token: "tt-new" } },
      { match: "creator_info/query", body: { data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } } },
      { match: "video/init", body: { data: { publish_id: "pub_1", upload_url: "https://upload.tiktok.test/v" }, error: { code: "ok" } } },
      { match: "upload.tiktok.test", body: "" },
    ]);
    setHttpClientForTests(http.client);
    const platforms = ["pinterest", "google_business", "wordpress", "blogger", "devto", "hashnode", "youtube", "tiktok"];
    const post = await createComposerPost(ws, { title: "Big launch day", description: "We launched a new website checker for small businesses.", content: "## What it does\n\nIt finds broken pages and slow images.", link: "https://brand.test/launch", hashtags: ["webdesign", "seo"], mediaIds: [a.id, b.id], alts: ["Red", "Green"], platforms });
    const { post: done } = await publishNow(ws, post.id);
    expect(Object.fromEntries(platforms.map((p) => [p, done.results[p]?.error ?? "ok"]))).toEqual(Object.fromEntries(platforms.map((p) => [p, "ok"])));
    expect(done.status).toBe("published");
    expect(done.results.pinterest.url).toBe("https://www.pinterest.com/pin/pin123/");
    expect(done.results.youtube.url).toBe("https://www.youtube.com/shorts/yt999");

    const body = (m: string) => JSON.parse(http.calls.find((c) => c.url.includes(m) && c.method === "POST")!.body!);
    // Pinterest: carousel pin with title, link and alt text.
    const pin = body("v5/pins");
    expect(pin).toMatchObject({ board_id: "b1", title: "Big launch day", link: "https://brand.test/launch", alt_text: "Red" });
    expect(pin.media_source.source_type).toBe("multiple_image_urls");
    expect(pin.media_source.items).toHaveLength(2);
    // Google Business: summary, CTA and photo.
    const gbp = body("localPosts");
    expect(gbp.callToAction).toEqual({ actionType: "LEARN_MORE", url: "https://brand.test/launch" });
    expect(gbp.media[0].sourceUrl).toContain(`/api/social/media/${a.id}.jpg`);
    expect(http.calls.find((c) => c.url.includes("localPosts"))).toBeTruthy();
    // WordPress: uploads to the media library, featured image, tags, excerpt.
    const wp = body("/wp-json/wp/v2/posts");
    expect(wp).toMatchObject({ title: "Big launch day", status: "publish", featured_media: 5, tags: [31, 31], excerpt: "We launched a new website checker for small businesses." });
    expect(wp.content).toContain("<h3>What it does</h3>");
    expect(http.calls.filter((c) => c.url.endsWith("/wp-json/wp/v2/media"))).toHaveLength(2);
    // Blogger: HTML article with labels.
    expect(body("blogger/v3")).toMatchObject({ title: "Big launch day", labels: ["webdesign", "seo"] });
    // DEV + Hashnode: canonical / original URL for SEO, cover image.
    const dev = body("dev.to/api/articles").article;
    expect(dev).toMatchObject({ canonical_url: "https://brand.test/launch", published: true, tags: ["webdesign", "seo"] });
    expect(dev.main_image).toContain(`/api/social/media/${a.id}.jpg`);
    expect(body("gql.hashnode.com").variables.input).toMatchObject({ publicationId: "pub1", originalArticleURL: "https://brand.test/launch" });
    // YouTube: resumable upload of a real MP4 with #Shorts.
    const yt = http.calls.find((c) => c.url.includes("upload.youtube.test"))!;
    expect(yt.method).toBe("PUT");
    expect(yt.body).toMatch(/^\[binary \d+ bytes\]$/);
    expect(body("upload/youtube/v3/videos").snippet.description).toContain("#Shorts");
    // TikTok: falls back to an allowed privacy level and stores the rotated refresh token.
    expect(body("video/init").post_info.privacy_level).toBe("SELF_ONLY");
    expect((await getConnection(ws, getConnectionDef("platform", "tiktok")!)).secrets.refreshToken).toBe("tt-new");
    // The video is stored once and reused.
    expect(done.videoId).toBeTruthy();
    const [video] = await withTenant(ws, (tx) => tx.select().from(schema.socialMedia).where(eq(schema.socialMedia.id, done.videoId!)));
    expect(video.mime).toBe("video/mp4");
  }, 180_000);

  it("re-renders the video after an edit and keeps blog articles on partial edits", async () => {
    setHttpClientForTests(fakeHttp([]).client);
    const p = await createComposerPost(ws, { title: "Video draft", description: "", content: "", link: null, hashtags: [], mediaIds: [], alts: [], platforms: ["youtube"] });
    const v1 = await prepareVideo(ws, p.id);
    expect((await prepareVideo(ws, p.id)).id).toBe(v1.id);
    await updatePost(ws, p.id, { platformTexts: { article: "## Kept" } });
    await updatePost(ws, p.id, { hook: "New hook", platformTexts: { linkedin: "li" } });
    const after = await getPost(ws, p.id);
    expect(after.videoId).toBeNull();
    expect(after.platformTexts).toEqual({ article: "## Kept", linkedin: "li" });
    expect((await prepareVideo(ws, p.id)).id).not.toBe(v1.id);
  }, 120_000);

  it("tests connections read-only", async () => {
    clearGoogleTokenCache();
    setHttpClientForTests(
      fakeHttp([
        { match: "v5/user_account", body: { username: "brandpins" } },
        { match: "oauth2.googleapis.com/token", body: { access_token: "g", expires_in: 3600 } },
        { match: "youtube/v3/channels", body: { items: [{ snippet: { title: "Brand TV" } }] } },
        { match: "dev.to/api/users/me", body: { username: "branddev" } },
      ]).client,
    );
    expect(await testConnection(ws, getConnectionDef("platform", "pinterest")!)).toEqual({ ok: true, message: "@brandpins" });
    expect(await testConnection(ws, getConnectionDef("platform", "youtube")!)).toEqual({ ok: true, message: "Channel “Brand TV”" });
    expect(await testConnection(ws, getConnectionDef("platform", "devto")!)).toEqual({ ok: true, message: "@branddev" });
  });
});
