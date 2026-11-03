import { assertOk, parseJson, ProviderHttpError, type HttpResponse } from "@/lib/providers/http";
import { safeFetch } from "@/lib/analysis/net";
import type { SocialMetrics, SocialPublishResult } from "@/lib/db/schema";
import type { Connection } from "./accounts";
import { buildArticle, cleanTags } from "./article";
import { composeText, imagesOf, withUtm, type PostContent, type PublishDeps, type PublishOutcome } from "./publish";

/** Pinterest, Google Business Profile, blogs and video platforms. */

const linkFor = (c: PostContent, platform: string) => (c.link ? (c.utm ? withUtm(c.link, platform) : c.link) : "");

function articleFor(c: PostContent, platform: string, images = imagesOf(c)) {
  return buildArticle({ title: c.hook, article: c.article, body: c.body, metaDescription: c.metaDescription, hashtags: c.hashtags, link: linkFor(c, platform), images: images.map((i) => ({ url: i.url, alt: i.alt })) });
}

function jsonError(res: HttpResponse, name: string, pick: (j: Record<string, unknown>) => unknown) {
  let detail = "";
  try {
    const v = pick(JSON.parse(res.text));
    detail = typeof v === "string" ? v : v ? JSON.stringify(v) : "";
  } catch {}
  return new ProviderHttpError(`${name} responded with HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`, res.status, res.status === 429 || res.status >= 500);
}

async function postJson<T>(d: PublishDeps, url: string, body: unknown, headers: Record<string, string>, name: string, pick: (j: Record<string, unknown>) => unknown = (j) => j.message ?? j.error) {
  const res = await d.http(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), timeoutMs: 30_000, retries: 1 });
  if (!res.ok) throw jsonError(res, name, pick);
  return parseJson<T>(res, name);
}

/* ----------------------------- Google OAuth ----------------------------- */

const googleTokens = new Map<string, { token: string; until: number }>();

/** Exchange the stored refresh token for a short-lived access token (cached ~50 min). */
export async function googleAccessToken(d: PublishDeps, conn: Connection) {
  const cached = googleTokens.get(conn.secrets.refreshToken);
  if (cached && cached.until > Date.now()) return cached.token;
  const res = await d.http("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: conn.secrets.clientId, client_secret: conn.secrets.clientSecret, refresh_token: conn.secrets.refreshToken, grant_type: "refresh_token" }).toString(),
    timeoutMs: 20_000,
  });
  if (!res.ok) throw jsonError(res, "Google OAuth", (j) => j.error_description ?? j.error);
  const r = parseJson<{ access_token: string; expires_in?: number }>(res, "Google OAuth");
  googleTokens.set(conn.secrets.refreshToken, { token: r.access_token, until: Date.now() + Math.max(60, (r.expires_in ?? 3600) - 600) * 1000 });
  return r.access_token;
}

export function clearGoogleTokenCache() {
  googleTokens.clear();
}

const googleError = (j: Record<string, unknown>) => (j.error as { message?: string })?.message ?? j.error;

/* ------------------------------- TikTok -------------------------------- */

async function tiktokAccessToken(d: PublishDeps, conn: Connection) {
  const res = await d.http("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: conn.secrets.clientKey, client_secret: conn.secrets.clientSecret, grant_type: "refresh_token", refresh_token: conn.secrets.refreshToken }).toString(),
    timeoutMs: 20_000,
  });
  const r = parseJson<{ access_token?: string; refresh_token?: string; error?: string; error_description?: string }>(res, "TikTok OAuth");
  if (!res.ok || !r.access_token) throw new ProviderHttpError(`TikTok OAuth: ${r.error_description ?? r.error ?? `HTTP ${res.status}`}`, res.status, res.status >= 500);
  // TikTok may rotate the refresh token; keep the newest one.
  if (r.refresh_token && r.refresh_token !== conn.secrets.refreshToken) await d.saveSecrets?.({ refreshToken: r.refresh_token });
  return r.access_token;
}

const tiktokError = (j: Record<string, unknown>) => (j.error as { message?: string; code?: string })?.message ?? (j.error as { code?: string })?.code;

async function videoBytes(d: PublishDeps, c: PostContent, platform: string) {
  if (!c.video || !d.loadMedia) throw new ProviderHttpError(`${platform} needs a video: add images (or keep branded cards on) so a slideshow can be made`, 400, false);
  return (await d.loadMedia(c.video.id)).data;
}

/* ----------------------------- Publishers ------------------------------ */

export const MORE_PUBLISHERS: Record<string, (d: PublishDeps, conn: Connection, c: PostContent) => Promise<PublishOutcome>> = {
  async pinterest(d, conn, c) {
    const images = imagesOf(c, 5);
    if (!images.length) throw new ProviderHttpError("Pinterest needs an image: upload one or keep branded image cards on", 400, false);
    const link = linkFor(c, "pinterest");
    const media_source =
      images.length === 1
        ? { source_type: "image_url", url: images[0].url }
        : { source_type: "multiple_image_urls", items: images.map((i) => ({ url: i.url, title: c.hook.slice(0, 100), ...(link ? { link } : {}) })) };
    const description = composeText("pinterest", { ...c, hook: "", link: c.link }).slice(0, 800);
    const r = await postJson<{ id: string }>(
      d,
      "https://api.pinterest.com/v5/pins",
      { board_id: conn.settings.boardId, title: c.hook.slice(0, 100), description, ...(link ? { link } : {}), ...(images[0].alt ? { alt_text: images[0].alt.slice(0, 500) } : {}), media_source },
      { Authorization: `Bearer ${conn.secrets.accessToken}` },
      "Pinterest",
    );
    return { id: r.id, url: `https://www.pinterest.com/pin/${r.id}/` };
  },

  async google_business(d, conn, c) {
    const token = await googleAccessToken(d, conn);
    const link = linkFor(c, "google_business");
    const images = imagesOf(c, 1);
    const r = await postJson<{ name: string; searchUrl?: string }>(
      d,
      `https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(conn.settings.accountId)}/locations/${encodeURIComponent(conn.settings.locationId)}/localPosts`,
      {
        languageCode: "en",
        summary: composeText("google_business", { ...c, hashtags: [] }).slice(0, 1500),
        topicType: "STANDARD",
        ...(link ? { callToAction: { actionType: "LEARN_MORE", url: link } } : {}),
        ...(images.length ? { media: [{ mediaFormat: "PHOTO", sourceUrl: images[0].url }] } : {}),
      },
      { Authorization: `Bearer ${token}` },
      "Google Business Profile",
      googleError,
    );
    return { id: r.name, url: r.searchUrl ?? null };
  },

  async wordpress(d, conn, c) {
    const base = conn.settings.siteUrl.replace(/\/+$/, "");
    if (!/^https?:\/\//.test(base)) throw new ProviderHttpError("WordPress site URL must start with https://", 400, false);
    const auth = { Authorization: `Basic ${Buffer.from(`${conn.settings.username}:${conn.secrets.appPassword}`).toString("base64")}` };
    const wp = async <T>(path: string, init: { method?: "GET" | "POST"; json?: unknown; raw?: { body: Uint8Array<ArrayBuffer>; headers: Record<string, string> } } = {}) => {
      const res = await safeFetch(d.http, d.resolve, `${base}/wp-json/wp/v2${path}`, {
        method: init.method ?? "GET",
        headers: { ...auth, ...(init.json ? { "Content-Type": "application/json" } : {}), ...init.raw?.headers },
        body: init.raw?.body ?? (init.json ? JSON.stringify(init.json) : undefined),
        timeoutMs: 60_000,
      });
      if (!res.ok) throw jsonError(res, "WordPress", (j) => j.message);
      return parseJson<T>(res, "WordPress");
    };
    // Uploads go into the media library (featured image + body); generated cards are linked.
    const images: { url: string; alt: string | null; wpId?: number }[] = [];
    for (const img of imagesOf(c)) {
      if (img.ref && d.loadMedia) {
        const file = await d.loadMedia(img.ref.id);
        const m = await wp<{ id: number; source_url: string }>("/media", { method: "POST", raw: { body: new Uint8Array(file.data), headers: { "Content-Type": file.mime, "Content-Disposition": `attachment; filename="${img.ref.id}.jpg"` } } });
        if (img.alt) await wp(`/media/${m.id}`, { method: "POST", json: { alt_text: img.alt } });
        images.push({ url: m.source_url, alt: img.alt, wpId: m.id });
      } else images.push({ url: img.url, alt: img.alt });
    }
    // The first upload is the featured image; the theme shows it, so the body starts with the rest.
    const featured = images[0]?.wpId;
    const a = buildArticle({ title: c.hook, article: c.article, body: c.body, metaDescription: c.metaDescription, hashtags: c.hashtags, link: linkFor(c, "wordpress"), images: featured ? images.slice(1) : images });
    const html = a.html;
    const tagIds: number[] = [];
    for (const t of a.tags.slice(0, 8)) {
      try {
        const found = await wp<{ id: number; slug: string }[]>(`/tags?search=${encodeURIComponent(t)}&per_page=10`);
        tagIds.push(found.find((x) => x.slug === t)?.id ?? (await wp<{ id: number }>("/tags", { method: "POST", json: { name: t } })).id);
      } catch {
        // Tags are a nice-to-have; posting must not fail because of them.
      }
    }
    const status = conn.settings.status === "draft" ? "draft" : "publish";
    const r = await wp<{ id: number; link: string }>("/posts", { method: "POST", json: { title: a.title, content: html, excerpt: a.excerpt, status, ...(featured ? { featured_media: featured } : {}), ...(tagIds.length ? { tags: tagIds } : {}) } });
    return { id: String(r.id), url: r.link };
  },

  async blogger(d, conn, c) {
    const token = await googleAccessToken(d, conn);
    const a = articleFor(c, "blogger");
    const r = await postJson<{ id: string; url: string }>(d, `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(conn.settings.blogId)}/posts/`, { kind: "blogger#post", title: a.title, content: a.html, labels: a.tags.slice(0, 10) }, { Authorization: `Bearer ${token}` }, "Blogger", googleError);
    return { id: r.id, url: r.url };
  },

  async devto(d, conn, c) {
    const a = articleFor(c, "devto");
    const r = await postJson<{ id: number; url: string }>(
      d,
      "https://dev.to/api/articles",
      { article: { title: a.title.slice(0, 128), body_markdown: a.markdown, published: true, tags: cleanTags(a.tags, 4).map((t) => t.replace(/[^a-z0-9]/g, "")).filter(Boolean), ...(a.coverUrl ? { main_image: a.coverUrl } : {}), ...(c.link ? { canonical_url: c.link } : {}), description: a.excerpt } },
      { "api-key": conn.secrets.apiKey, Accept: "application/vnd.forem.api-v1+json" },
      "DEV",
      (j) => j.error,
    );
    return { id: String(r.id), url: r.url };
  },

  async hashnode(d, conn, c) {
    const a = articleFor(c, "hashnode");
    const query = "mutation PublishPost($input: PublishPostInput!) { publishPost(input: $input) { post { id url } } }";
    const input = {
      publicationId: conn.settings.publicationId,
      title: a.title,
      subtitle: a.excerpt.slice(0, 150),
      contentMarkdown: a.markdown,
      tags: a.tags.slice(0, 5).map((t) => ({ slug: t, name: t })),
      ...(a.coverUrl ? { coverImageOptions: { coverImageURL: a.coverUrl } } : {}),
      ...(c.link ? { originalArticleURL: c.link } : {}),
    };
    const res = await d.http("https://gql.hashnode.com", { method: "POST", headers: { "Content-Type": "application/json", Authorization: conn.secrets.token }, body: JSON.stringify({ query, variables: { input } }), timeoutMs: 30_000, retries: 1 });
    const r = parseJson<{ data?: { publishPost?: { post?: { id: string; url: string } } }; errors?: { message: string }[] }>(res, "Hashnode");
    if (!res.ok || r.errors?.length || !r.data?.publishPost?.post) throw new ProviderHttpError(`Hashnode: ${r.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`}`, res.status, res.status === 429 || res.status >= 500);
    return { id: r.data.publishPost.post.id, url: r.data.publishPost.post.url };
  },

  async youtube(d, conn, c) {
    const video = await videoBytes(d, c, "YouTube");
    const token = await googleAccessToken(d, conn);
    const privacy = ["public", "unlisted", "private"].includes(conn.settings.privacy) ? conn.settings.privacy : "public";
    const tags = cleanTags([...c.hashtags, "shorts"], 15);
    const description = `${composeText("youtube", { ...c, hook: "" })}\n\n#Shorts`.slice(0, 4900);
    const init = await d.http("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(video.length), "X-Upload-Content-Type": "video/mp4" },
      body: JSON.stringify({ snippet: { title: c.hook.slice(0, 100), description, tags, categoryId: "22" }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } }),
      timeoutMs: 30_000,
    });
    if (!init.ok) throw jsonError(init, "YouTube", googleError);
    const location = init.headers.get("location");
    if (!location) throw new ProviderHttpError("YouTube did not return an upload URL", init.status, true);
    const up = await d.http(location, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: new Uint8Array(video), timeoutMs: 300_000, retries: 0 });
    if (!up.ok) throw jsonError(up, "YouTube upload", googleError);
    const id = parseJson<{ id: string }>(up, "YouTube").id;
    return { id, url: `https://www.youtube.com/shorts/${id}` };
  },

  async tiktok(d, conn, c) {
    const video = await videoBytes(d, c, "TikTok");
    const token = await tiktokAccessToken(d, conn);
    const auth = { Authorization: `Bearer ${token}` };
    // TikTok requires checking which privacy levels this creator may use before posting.
    const info = await postJson<{ data?: { privacy_level_options?: string[] } }>(d, "https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {}, auth, "TikTok", tiktokError);
    const options = info.data?.privacy_level_options ?? ["SELF_ONLY"];
    const wanted = conn.settings.privacy || "SELF_ONLY";
    const privacy = options.includes(wanted) ? wanted : options.includes("SELF_ONLY") ? "SELF_ONLY" : options[0];
    const init = await postJson<{ data?: { publish_id: string; upload_url: string } }>(
      d,
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      { post_info: { title: composeText("tiktok", c).slice(0, 2200), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false }, source_info: { source: "FILE_UPLOAD", video_size: video.length, chunk_size: video.length, total_chunk_count: 1 } },
      auth,
      "TikTok",
      tiktokError,
    );
    if (!init.data?.upload_url) throw new ProviderHttpError("TikTok did not return an upload URL", null, true);
    const up = await d.http(init.data.upload_url, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Range": `bytes 0-${video.length - 1}/${video.length}` }, body: new Uint8Array(video), timeoutMs: 300_000, retries: 0 });
    if (!up.ok) throw new ProviderHttpError(`TikTok upload responded with HTTP ${up.status}`, up.status, up.status >= 500);
    // TikTok processes the video asynchronously; the post appears on the profile once done.
    return { id: init.data.publish_id, url: null };
  },
};

export const MORE_METRICS: Record<string, (d: PublishDeps, conn: Connection, post: SocialPublishResult) => Promise<SocialMetrics>> = {
  async youtube(d, conn, post) {
    const token = await googleAccessToken(d, conn);
    const res = await d.http(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(post.id!)}`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 20_000 });
    assertOk(res, "YouTube");
    const s = parseJson<{ items: { statistics: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(res, "YouTube").items[0]?.statistics ?? {};
    return { likes: Number(s.likeCount ?? 0), comments: Number(s.commentCount ?? 0), shares: 0, views: Number(s.viewCount ?? 0) };
  },
  async devto(d, _conn, post) {
    const res = await d.http(`https://dev.to/api/articles/${encodeURIComponent(post.id!)}`, { timeoutMs: 20_000 });
    assertOk(res, "DEV");
    const a = parseJson<{ public_reactions_count?: number; comments_count?: number }>(res, "DEV");
    return { likes: a.public_reactions_count ?? 0, comments: a.comments_count ?? 0, shares: 0 };
  },
};

/** Read-only connection checks for the platforms above. */
export async function testMorePlatform(d: PublishDeps, platform: string, conn: Connection): Promise<{ ok: boolean; message: string } | null> {
  const get = async (url: string, name: string, headers: Record<string, string>) => {
    const res = await d.http(url, { headers, timeoutMs: 15_000, retries: 0 });
    assertOk(res, name);
    return res;
  };
  switch (platform) {
    case "pinterest": {
      const r = parseJson<{ username?: string }>(await get("https://api.pinterest.com/v5/user_account", "Pinterest", { Authorization: `Bearer ${conn.secrets.accessToken}` }), "Pinterest");
      return { ok: true, message: `@${r.username ?? "me"}` };
    }
    case "google_business": {
      const token = await googleAccessToken(d, conn);
      const r = parseJson<{ title?: string }>(await get(`https://mybusinessbusinessinformation.googleapis.com/v1/locations/${encodeURIComponent(conn.settings.locationId)}?readMask=title`, "Google Business Profile", { Authorization: `Bearer ${token}` }), "Google Business Profile");
      return { ok: true, message: `Location “${r.title ?? conn.settings.locationId}”` };
    }
    case "wordpress": {
      const base = conn.settings.siteUrl.replace(/\/+$/, "");
      const res = await safeFetch(d.http, d.resolve, `${base}/wp-json/wp/v2/users/me?context=edit`, { headers: { Authorization: `Basic ${Buffer.from(`${conn.settings.username}:${conn.secrets.appPassword}`).toString("base64")}` }, timeoutMs: 15_000 });
      assertOk(res, "WordPress");
      return { ok: true, message: `Logged in as ${parseJson<{ name?: string }>(res, "WordPress").name ?? conn.settings.username}` };
    }
    case "blogger": {
      const token = await googleAccessToken(d, conn);
      const r = parseJson<{ name?: string }>(await get(`https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(conn.settings.blogId)}`, "Blogger", { Authorization: `Bearer ${token}` }), "Blogger");
      return { ok: true, message: `Blog “${r.name ?? conn.settings.blogId}”` };
    }
    case "devto": {
      const r = parseJson<{ username?: string }>(await get("https://dev.to/api/users/me", "DEV", { "api-key": conn.secrets.apiKey, Accept: "application/vnd.forem.api-v1+json" }), "DEV");
      return { ok: true, message: `@${r.username ?? "me"}` };
    }
    case "hashnode": {
      const res = await d.http("https://gql.hashnode.com", { method: "POST", headers: { "Content-Type": "application/json", Authorization: conn.secrets.token }, body: JSON.stringify({ query: "{ me { username } }" }), timeoutMs: 15_000 });
      const r = parseJson<{ data?: { me?: { username: string } }; errors?: { message: string }[] }>(res, "Hashnode");
      return r.data?.me ? { ok: true, message: `@${r.data.me.username}` } : { ok: false, message: r.errors?.[0]?.message ?? "Token rejected" };
    }
    case "youtube": {
      const token = await googleAccessToken(d, conn);
      const r = parseJson<{ items?: { snippet?: { title?: string } }[] }>(await get("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", "YouTube", { Authorization: `Bearer ${token}` }), "YouTube");
      return r.items?.length ? { ok: true, message: `Channel “${r.items[0].snippet?.title}”` } : { ok: false, message: "No YouTube channel on this Google account" };
    }
    case "tiktok": {
      const token = await tiktokAccessToken(d, conn);
      const r = parseJson<{ data?: { user?: { display_name?: string } } }>(await get("https://open.tiktokapis.com/v2/user/info/?fields=display_name", "TikTok", { Authorization: `Bearer ${token}` }), "TikTok");
      return { ok: true, message: r.data?.user?.display_name ?? "Token valid" };
    }
    default:
      return null;
  }
}
