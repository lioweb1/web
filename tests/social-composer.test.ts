import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema, systemDb, withTenant } from "@/lib/db";
import { setHttpClientForTests } from "@/lib/services/integrations";
import { getConnectionDef, saveConnection } from "@/lib/social/accounts";
import { LINK_TOKEN } from "@/lib/social/ai";
import { cleanupOrphanMedia, mediaUrl, processImage, saveUpload, verifyMediaSignature } from "@/lib/social/media";
import { composerFields, createComposerPost, DEFAULT_CONFIG, publishNow, saveAutopilot, setSocialResolverForTests, splitForThread } from "@/lib/social/service";
import { fakeHttp } from "./helpers/fake-http";
import { makeUser } from "./helpers/db";

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 90, alpha: 0.5 } } }).png().toBuffer();

describe("composer: pure helpers", () => {
  it("normalises images: JPEG, max 2048px, Instagram aspect range, under 1 MB", async () => {
    const tall = await processImage(await png(600, 2000));
    expect(tall.mime).toBe("image/jpeg");
    expect(tall.width / tall.height).toBeGreaterThanOrEqual(0.799);
    const wide = await processImage(await png(4000, 1000));
    expect(wide.width).toBeLessThanOrEqual(2048);
    expect(wide.width / wide.height).toBeLessThanOrEqual(1.92);
    const noisy = await sharp(Buffer.from(Array.from({ length: 3000 * 3000 * 3 }, () => Math.floor(Math.random() * 256))), { raw: { width: 3000, height: 3000, channels: 3 } }).png().toBuffer();
    const small = await processImage(noisy);
    expect(small.data.length).toBeLessThanOrEqual(1_000_000);
    await expect(processImage(Buffer.from("not an image"))).rejects.toThrow(/not a supported image/);
  }, 60_000);

  it("keeps the user's text and continues long content as a thread", () => {
    const content = "First point is important. ".repeat(30).trim();
    const f = composerFields({ title: "My title", description: "Short summary", content, link: "https://x.test" });
    expect(f.hook).toBe("My title");
    expect(f.body).toBe(`Short summary\n\n${content}\n\n👉 ${LINK_TOKEN}`);
    expect(f.shortBody).toBe(`Short summary\n\n👉 ${LINK_TOKEN}`);
    expect(f.thread.join(" ").replace(/\s+/g, " ")).toBe(content);
    expect(f.thread.every((p) => Array.from(p).length <= 280)).toBe(true);
    const only = composerFields({ title: "T", description: "", content: "", link: null });
    expect(only).toMatchObject({ body: "T", shortBody: "T", thread: [] });
  });

  it("splits Bangla and very long words safely", () => {
    const parts = splitForThread(`${"আমাদের ওয়েবসাইট দ্রুত। ".repeat(40)}${"x".repeat(400)}`, 100);
    expect(parts.every((p) => Array.from(p).length <= 100)).toBe(true);
  });
});

describe("composer: upload and publish instantly", () => {
  let ws: string, other: string;
  beforeAll(async () => {
    ws = (await makeUser("Composer")).workspace.id;
    other = (await makeUser("Composer other")).workspace.id;
    setSocialResolverForTests(async () => ["93.184.216.34"]);
    await saveAutopilot(ws, { active: false, intervalMinutes: 180, config: { ...DEFAULT_CONFIG, utm: false } });
    for (const [id, settings, secrets] of [
      ["facebook", { pageId: "123" }, { accessToken: "fb" }],
      ["instagram", { igUserId: "ig1" }, { accessToken: "ig" }],
      ["bluesky", { handle: "brand.bsky.social" }, { appPassword: "pw" }],
      ["telegram", { chatId: "@brandchannel" }, { botToken: "tg" }],
      ["mastodon", { instanceUrl: "https://mastodon.example" }, { accessToken: "ma" }],
    ] as const)
      await saveConnection(ws, getConnectionDef("platform", id)!, { enabled: true, settings: { ...settings }, secrets: { ...secrets } });
  });
  afterAll(() => {
    setHttpClientForTests(null);
    setSocialResolverForTests(null);
  });

  it("serves uploads only with a valid signature", async () => {
    const up = await saveUpload(ws, { bytes: await png(800, 800), type: "image/png" });
    expect(verifyMediaSignature(up.id, new URL(mediaUrl(up.id, { absolute: true })).searchParams.get("sig")!)).toBe(true);
    expect(verifyMediaSignature(up.id, "0".repeat(32))).toBe(false);
    await expect(saveUpload(ws, { bytes: Buffer.from("x"), type: "application/pdf" })).rejects.toThrow(/Upload a JPEG/);
    // Unattached uploads are removed after a day.
    await systemDb().update(schema.socialMedia).set({ createdAt: new Date(Date.now() - 2 * 86400_000) }).where(eq(schema.socialMedia.id, up.id));
    expect(await cleanupOrphanMedia()).toBeGreaterThanOrEqual(1);
  });

  it("publishes the same post with images everywhere in one go", async () => {
    const a = await saveUpload(ws, { bytes: await png(1200, 1200), type: "image/png" });
    const b = await saveUpload(ws, { bytes: await png(1200, 900), type: "image/png" });
    let photo = 0;
    const http = fakeHttp([
      { match: "/photos", body: { get id() { return `ph${++photo}`; } } as unknown as object },
      { match: "/123/feed", body: { id: "123_post" } },
      { match: /ig1\/media$/, body: { id: "igc" } },
      { match: "media_publish", body: { id: "igpost" } },
      { match: "fields=permalink", body: { permalink: "https://instagram.com/p/x" } },
      { match: "createSession", body: { accessJwt: "jwt", did: "did:plc:me", handle: "brand.bsky.social" } },
      { match: "uploadBlob", body: { blob: { $type: "blob", ref: { $link: "bafy" }, mimeType: "image/jpeg", size: 100 } } },
      { match: "createRecord", body: { uri: "at://did:plc:me/app.bsky.feed.post/abc", cid: "c" } },
      { match: "sendMediaGroup", body: { ok: true, result: [{ message_id: 7 }, { message_id: 8 }] } },
      { match: "sendMessage", body: { ok: true, result: { message_id: 9 } } },
      { match: "/api/v2/media", body: { id: "m1" } },
      { match: "/api/v1/statuses", body: { id: "s1", url: "https://mastodon.example/@me/s1" } },
    ]);
    setHttpClientForTests(http.client);
    const content = "Here is everything you need to know. ".repeat(20).trim();
    const post = await createComposerPost(ws, { title: "Big news for small businesses", description: "We launched something new", content, link: "https://brand.test/launch", hashtags: ["#launch", "smallbusiness"], mediaIds: [a.id, b.id], alts: ["Cover alt", ""], platforms: ["facebook", "instagram", "bluesky", "telegram", "mastodon"] });
    expect(post.sourceId).toBe("composer");
    expect(post.mediaIds).toEqual([a.id, b.id]);
    const { post: done, retrying } = await publishNow(ws, post.id);
    expect(retrying).toBe(false);
    expect(done.status).toBe("published");
    expect(Object.values(done.results).every((r) => r.ok)).toBe(true);

    // Facebook: two unpublished photos attached to one feed post with the user's text.
    const fbPhotos = http.calls.filter((c) => c.url.includes("/photos"));
    expect(fbPhotos).toHaveLength(2);
    expect(new URLSearchParams(fbPhotos[0].body).get("published")).toBe("false");
    const feed = new URLSearchParams(http.calls.find((c) => c.url.includes("/123/feed"))!.body);
    expect(feed.get("message")!.startsWith(`Big news for small businesses\n\nWe launched something new\n\n${content}\n\n👉 https://brand.test/launch`)).toBe(true);
    expect(feed.get("attached_media[1]")).toBe(JSON.stringify({ media_fbid: "ph2" }));

    // Instagram: carousel of two children.
    const ig = http.calls.filter((c) => /ig1\/media$/.test(c.url)).map((c) => new URLSearchParams(c.body));
    expect(ig.filter((x) => x.get("is_carousel_item") === "true")).toHaveLength(2);
    expect(ig.find((x) => x.get("media_type") === "CAROUSEL")!.get("caption")).toContain("link in bio");
    expect(ig[0].get("image_url")).toContain(`/api/social/media/${a.id}.jpg?sig=`);
    expect(ig[0].get("alt_text")).toBe("Cover alt");

    // Bluesky: two blobs on the first post, rest of the content as a thread.
    expect(http.calls.filter((c) => c.url.includes("uploadBlob"))).toHaveLength(2);
    const records = http.calls.filter((c) => c.url.includes("createRecord")).map((c) => JSON.parse(c.body!).record);
    expect(records[0].embed.images).toHaveLength(2);
    expect(records[0].text.startsWith("Big news for small businesses\n\nWe launched something new")).toBe(true);
    expect(records.length).toBeGreaterThan(2);
    expect(records.every((r: { text: string }) => Array.from(r.text).length <= 300)).toBe(true);

    // Telegram: album, then the full text (too long for a caption).
    expect(JSON.parse(http.calls.find((c) => c.url.includes("sendMediaGroup"))!.body!).media).toHaveLength(2);
    expect(done.results.telegram.url).toBe("https://t.me/brandchannel/7");

    // Mastodon: multipart upload, then a status with media_ids[].
    const mUpload = http.calls.find((c) => c.url.includes("/api/v2/media"))!;
    expect(mUpload.body).toMatch(/^\[binary \d+ bytes\]$/);
    expect(new URLSearchParams(http.calls.find((c) => c.url.endsWith("/api/v1/statuses"))!.body).getAll("media_ids[]")).toEqual(["m1", "m1"]);

    // Images now belong to the post; another workspace cannot reuse them.
    const owned = await withTenant(ws, (tx) => tx.select().from(schema.socialMedia).where(eq(schema.socialMedia.postId, post.id)));
    expect(owned).toHaveLength(2);
    await saveConnection(other, getConnectionDef("platform", "facebook")!, { enabled: true, settings: { pageId: "9" }, secrets: { accessToken: "x" } });
    await expect(createComposerPost(other, { title: "steal", description: "", content: "", link: null, hashtags: [], mediaIds: [a.id], alts: [], platforms: ["facebook"] })).rejects.toThrow(/not found/);
  });

  it("reports failures and schedules a retry only for temporary errors", async () => {
    setHttpClientForTests(fakeHttp([{ match: "/feed", status: 500, body: { error: { message: "temporary" } } }]).client);
    const p = await createComposerPost(ws, { title: "Retry me", description: "", content: "", link: null, hashtags: [], mediaIds: [], alts: [], platforms: ["facebook"] });
    const r = await publishNow(ws, p.id);
    expect(r.retrying).toBe(true);
    expect(r.post.results.facebook.ok).toBe(false);
    const jobs = await systemDb().select().from(schema.jobs).where(eq(schema.jobs.type, "social_publish"));
    expect(jobs.some((j) => (j.payload as { postId: string }).postId === p.id && j.status === "queued")).toBe(true);
  });
});
