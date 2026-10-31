import { assertOk, parseJson, ProviderHttpError, type HttpClient } from "@/lib/providers/http";
import { safeFetch, type Resolver } from "@/lib/analysis/net";
import type { SocialMetrics, SocialPublishResult } from "@/lib/db/schema";
import { LINK_TOKEN } from "./ai";
import type { Connection } from "./accounts";

export type PostContent = {
  hook: string;
  body: string;
  shortBody: string;
  platformTexts?: Record<string, string>;
  thread?: string[];
  hashtags: string[];
  imageUrl: string | null;
  altText?: string | null;
  link: string;
  utm?: boolean;
  threadMode?: boolean;
};
export type PublishOutcome = { id: string | null; url: string | null; cid?: string | null };
export type PublishDeps = { http: HttpClient; resolve: Resolver };

const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;
const THREADS = "https://graph.threads.net/v1.0";

/** Character limits (Bluesky counts graphemes; code points are close enough for our text). */
export const LIMITS: Record<string, number> = { bluesky: 300, threads: 500, mastodon: 500, discord: 2000, telegram: 4096, instagram: 2200, linkedin: 3000, facebook: 5000 };
const SHORT = new Set(["bluesky", "threads", "mastodon"]);
/** Platforms that show more hashtags well; others get the first few. */
const TAG_COUNT: Record<string, number> = { instagram: 8, linkedin: 4, threads: 2, bluesky: 2, mastodon: 4, facebook: 3, telegram: 3 };

const len = (s: string) => Array.from(s).length;

function truncate(s: string, max: number) {
  return len(s) <= max ? s : `${Array.from(s).slice(0, max - 1).join("").trimEnd()}…`;
}

/** Tag the link so analytics can attribute clicks to the platform. */
export function withUtm(link: string, platform: string) {
  try {
    const u = new URL(link);
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", platform);
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", "social");
    if (!u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", "autopilot");
    return u.toString();
  } catch {
    return link;
  }
}

/** Final text for one platform: hook + platform-style body, link placed, hashtags if they fit. */
export function composeText(platform: string, c: PostContent): string {
  const max = LIMITS[platform] ?? 2000;
  const link = c.link ? (c.utm ? withUtm(c.link, platform) : c.link) : "";
  const linkText = platform === "instagram" ? "link in bio 🔗" : link;
  const base = (c.platformTexts?.[platform] ?? (SHORT.has(platform) ? c.shortBody : c.body)).trim();
  let text = !c.hook || base.startsWith(c.hook) ? base : `${c.hook}\n\n${base}`;
  text = link || platform === "instagram" ? text.split(LINK_TOKEN).join(linkText) : text.replace(new RegExp(`\\s*\\S*\\s*${LINK_TOKEN.replace(/[{}]/g, "\\$&")}`, "g"), "").trim();
  const tags = c.hashtags.slice(0, TAG_COUNT[platform] ?? 0).map((h) => `#${h}`).join(" ");
  if (tags && len(`${text}\n\n${tags}`) <= max) text = `${text}\n\n${tags}`;
  if (len(text) > max) {
    // Keep the link visible when truncating.
    const tail = link && text.includes(link) ? ` ${link}` : "";
    text = truncate(tail ? text.replace(link, "").trim() : text, max - len(tail)) + tail;
  }
  return text;
}

/** Follow-up thread parts with the link placed and each part within the platform limit. */
export function composeThread(platform: string, c: PostContent): string[] {
  if (!c.threadMode || !c.thread?.length) return [];
  const link = c.link ? (c.utm ? withUtm(c.link, platform) : c.link) : "";
  return c.thread.map((t) => truncate(link ? t.split(LINK_TOKEN).join(link) : t.split(LINK_TOKEN).join("").trim(), LIMITS[platform] ?? 300));
}

function form(data: Record<string, string>) {
  return new URLSearchParams(data).toString();
}

function graphError(res: { status: number; text: string }, name: string) {
  let detail = "";
  try {
    detail = (JSON.parse(res.text) as { error?: { message?: string } }).error?.message ?? "";
  } catch {}
  return new ProviderHttpError(`${name} responded with HTTP ${res.status}${detail ? `: ${detail}` : ""}`, res.status, res.status === 429 || res.status >= 500);
}

async function graphPost<T>(http: HttpClient, url: string, data: Record<string, string>, name: string) {
  const res = await http(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(data), timeoutMs: 30_000, retries: 1 });
  if (!res.ok) throw graphError(res, name);
  return parseJson<T>(res, name);
}

async function graphGet<T>(http: HttpClient, url: string, name: string) {
  const res = await http(url, { timeoutMs: 20_000, retries: 1 });
  if (!res.ok) throw graphError(res, name);
  return parseJson<T>(res, name);
}

export async function blueskySession(http: HttpClient, conn: Connection) {
  const service = "https://bsky.social";
  const res = await http(`${service}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: conn.settings.handle?.replace(/^@/, ""), password: conn.secrets.appPassword }),
    timeoutMs: 20_000,
  });
  assertOk(res, "Bluesky login");
  const s = parseJson<{ accessJwt: string; did: string; handle: string }>(res, "Bluesky login");
  return { ...s, service };
}

/** Link facets so URLs in Bluesky posts are clickable (byte offsets in UTF-8). */
export function blueskyFacets(text: string) {
  const facets: unknown[] = [];
  const enc = new TextEncoder();
  for (const m of text.matchAll(/https?:\/\/[^\s)]+/g)) {
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    facets.push({ index: { byteStart, byteEnd: byteStart + enc.encode(m[0]).length }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const start = m.index! + m[1].length;
    const byteStart = enc.encode(text.slice(0, start)).length;
    facets.push({ index: { byteStart, byteEnd: byteStart + enc.encode(`#${m[2]}`).length }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[2] }] });
  }
  return facets;
}

type StrongRef = { uri: string; cid: string };

async function blueskyPost(http: HttpClient, s: Awaited<ReturnType<typeof blueskySession>>, text: string, reply?: { root: StrongRef; parent: StrongRef }) {
  const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString() };
  const facets = blueskyFacets(text);
  if (facets.length) record.facets = facets;
  if (reply) record.reply = reply;
  const res = await http(`${s.service}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.accessJwt}` },
    body: JSON.stringify({ repo: s.did, collection: "app.bsky.feed.post", record }),
    timeoutMs: 20_000,
  });
  assertOk(res, "Bluesky");
  return parseJson<StrongRef>(res, "Bluesky");
}

async function threadsPublish(http: HttpClient, token: string, data: Record<string, string>) {
  const container = await graphPost<{ id: string }>(http, `${THREADS}/me/threads`, { ...data, access_token: token }, "Threads");
  return graphPost<{ id: string }>(http, `${THREADS}/me/threads_publish`, { creation_id: container.id, access_token: token }, "Threads");
}

async function mastodonFetch(d: PublishDeps, conn: Connection, path: string, init: { method?: "GET" | "POST"; body?: Record<string, string> } = {}) {
  const base = conn.settings.instanceUrl.replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) throw new ProviderHttpError("Mastodon instance URL must start with https://", 400, false);
  const res = await safeFetch(d.http, d.resolve, `${base}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${conn.secrets.accessToken}`, ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: init.body ? form(init.body) : undefined,
    timeoutMs: 20_000,
  });
  assertOk(res, "Mastodon");
  return res;
}

export async function telegramCall<T>(http: HttpClient, token: string, method: string, payload: Record<string, unknown>) {
  const res = await http(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), timeoutMs: 20_000 });
  const r = parseJson<{ ok: boolean; description?: string; result?: T }>(res, "Telegram");
  if (!r.ok) throw new ProviderHttpError(`Telegram: ${r.description ?? `HTTP ${res.status}`}`, res.status, res.status === 429 || res.status >= 500);
  return r.result as T;
}

type Publisher = (d: PublishDeps, conn: Connection, c: PostContent) => Promise<PublishOutcome>;

export const PUBLISHERS: Record<string, Publisher> = {
  async facebook(d, conn, c) {
    const text = composeText("facebook", c);
    const token = conn.secrets.accessToken;
    const page = encodeURIComponent(conn.settings.pageId);
    if (c.imageUrl) {
      const r = await graphPost<{ id: string; post_id?: string }>(d.http, `${GRAPH()}/${page}/photos`, { url: c.imageUrl, caption: text, access_token: token }, "Facebook");
      return { id: r.post_id ?? r.id, url: `https://www.facebook.com/${r.post_id ?? r.id}` };
    }
    const link = c.link ? (c.utm ? withUtm(c.link, "facebook") : c.link) : "";
    const r = await graphPost<{ id: string }>(d.http, `${GRAPH()}/${page}/feed`, { message: text, ...(link ? { link } : {}), access_token: token }, "Facebook");
    return { id: r.id, url: `https://www.facebook.com/${r.id}` };
  },

  async instagram(d, conn, c) {
    const image = c.imageUrl || conn.settings.defaultImageUrl;
    if (!image) throw new ProviderHttpError("Instagram needs an image: turn on branded image cards, add an image URL to the post, or set a default image", 400, false);
    const user = encodeURIComponent(conn.settings.igUserId);
    const token = conn.secrets.accessToken;
    const container = await graphPost<{ id: string }>(d.http, `${GRAPH()}/${user}/media`, { image_url: image, caption: composeText("instagram", c), ...(c.altText ? { alt_text: c.altText } : {}), access_token: token }, "Instagram");
    const pub = await graphPost<{ id: string }>(d.http, `${GRAPH()}/${user}/media_publish`, { creation_id: container.id, access_token: token }, "Instagram");
    let url: string | null = null;
    try {
      url = (await graphGet<{ permalink?: string }>(d.http, `${GRAPH()}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`, "Instagram")).permalink ?? null;
    } catch {}
    return { id: pub.id, url };
  },

  async threads(d, conn, c) {
    const token = conn.secrets.accessToken;
    const pub = await threadsPublish(d.http, token, { media_type: c.imageUrl ? "IMAGE" : "TEXT", text: composeText("threads", c), ...(c.imageUrl ? { image_url: c.imageUrl } : {}), ...(c.imageUrl && c.altText ? { alt_text: c.altText } : {}) });
    let parent = pub.id;
    for (const part of composeThread("threads", c)) parent = (await threadsPublish(d.http, token, { media_type: "TEXT", text: part, reply_to_id: parent })).id;
    let url: string | null = null;
    try {
      url = (await graphGet<{ permalink?: string }>(d.http, `${THREADS}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`, "Threads")).permalink ?? null;
    } catch {}
    return { id: pub.id, url };
  },

  async bluesky(d, conn, c) {
    const s = await blueskySession(d.http, conn);
    const root = await blueskyPost(d.http, s, composeText("bluesky", c));
    let parent = root;
    for (const part of composeThread("bluesky", c)) parent = await blueskyPost(d.http, s, part, { root, parent });
    return { id: root.uri, cid: root.cid, url: `https://bsky.app/profile/${s.handle}/post/${root.uri.split("/").pop()}` };
  },

  async mastodon(d, conn, c) {
    const res = await mastodonFetch(d, conn, "/api/v1/statuses", { method: "POST", body: { status: composeText("mastodon", c), visibility: "public" } });
    const r = parseJson<{ id: string; url?: string }>(res, "Mastodon");
    let parent = r.id;
    for (const part of composeThread("mastodon", c)) parent = parseJson<{ id: string }>(await mastodonFetch(d, conn, "/api/v1/statuses", { method: "POST", body: { status: part, visibility: "public", in_reply_to_id: parent } }), "Mastodon").id;
    return { id: r.id, url: r.url ?? null };
  },

  async telegram(d, conn, c) {
    if (!conn.settings.chatId) throw new ProviderHttpError("Set the Telegram channel to post to", 400, false);
    const text = composeText("telegram", c);
    const r =
      c.imageUrl && len(text) <= 1024
        ? await telegramCall<{ message_id: number }>(d.http, conn.secrets.botToken, "sendPhoto", { chat_id: conn.settings.chatId, photo: c.imageUrl, caption: text })
        : await telegramCall<{ message_id: number }>(d.http, conn.secrets.botToken, "sendMessage", { chat_id: conn.settings.chatId, text });
    const chat = conn.settings.chatId.startsWith("@") ? conn.settings.chatId.slice(1) : null;
    return { id: String(r.message_id), url: chat ? `https://t.me/${chat}/${r.message_id}` : null };
  },

  async discord(d, conn, c) {
    const hook = conn.secrets.webhookUrl;
    if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//.test(hook ?? "")) throw new ProviderHttpError("Discord webhook URL must be a https://discord.com/api/webhooks/… URL", 400, false);
    const res = await d.http(`${hook}${hook.includes("?") ? "&" : "?"}wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: composeText("discord", c), ...(c.imageUrl ? { embeds: [{ image: { url: c.imageUrl } }] } : {}) }),
      timeoutMs: 20_000,
    });
    assertOk(res, "Discord");
    const r = parseJson<{ id: string; channel_id?: string; guild_id?: string }>(res, "Discord");
    return { id: r.id, url: r.guild_id && r.channel_id ? `https://discord.com/channels/${r.guild_id}/${r.channel_id}/${r.id}` : null };
  },

  async linkedin(d, conn, c) {
    const auth = { Authorization: `Bearer ${conn.secrets.accessToken}` };
    const me = await d.http("https://api.linkedin.com/v2/userinfo", { headers: auth, timeoutMs: 15_000 });
    assertOk(me, "LinkedIn");
    const sub = parseJson<{ sub: string }>(me, "LinkedIn").sub;
    const text = composeText("linkedin", c);
    const link = c.link ? (c.utm ? withUtm(c.link, "linkedin") : c.link) : "";
    const content = link
      ? { shareCommentary: { text }, shareMediaCategory: "ARTICLE", media: [{ status: "READY", originalUrl: link, title: { text: c.hook.slice(0, 200) } }] }
      : { shareCommentary: { text }, shareMediaCategory: "NONE" };
    const res = await d.http("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0" },
      body: JSON.stringify({ author: `urn:li:person:${sub}`, lifecycleState: "PUBLISHED", specificContent: { "com.linkedin.ugc.ShareContent": content }, visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" } }),
      timeoutMs: 20_000,
    });
    assertOk(res, "LinkedIn");
    const id = res.headers.get("x-restli-id") ?? (JSON.parse(res.text || "{}") as { id?: string }).id ?? null;
    return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : null };
  },
};

/* ------------------------------------------------------------------ */
/* Comments, replies, metrics                                           */
/* ------------------------------------------------------------------ */

export type RemoteComment = { externalId: string; cid?: string | null; authorHandle: string | null; authorName: string | null; text: string; commentedAt: Date | null; url: string | null };
export type CommentRef = { externalId: string; cid?: string | null; authorHandle?: string | null };

const htmlToText = (s: string) => s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** Platforms whose official API lets us read and answer comments on our own posts. */
export const ENGAGE_PLATFORMS = ["facebook", "instagram", "threads", "bluesky", "mastodon"];

/** Top-level comments on one of our published posts (our own replies are nested, so never returned). */
export const COMMENT_FETCHERS: Record<string, (d: PublishDeps, conn: Connection, post: SocialPublishResult) => Promise<RemoteComment[]>> = {
  async facebook(d, conn, post) {
    const r = await graphGet<{ data: { id: string; message?: string; created_time?: string; from?: { id?: string; name?: string } }[] }>(
      d.http,
      `${GRAPH()}/${post.id}/comments?filter=toplevel&order=reverse_chronological&limit=50&fields=id,message,created_time,from&access_token=${encodeURIComponent(conn.secrets.accessToken)}`,
      "Facebook",
    );
    return r.data
      .filter((c) => c.message && c.from?.id !== conn.settings.pageId)
      .map((c) => ({ externalId: c.id, authorHandle: c.from?.id ?? null, authorName: c.from?.name ?? null, text: c.message!, commentedAt: c.created_time ? new Date(c.created_time) : null, url: post.url ? `${post.url}?comment_id=${c.id.split("_").pop()}` : null }));
  },
  async instagram(d, conn, post) {
    const r = await graphGet<{ data: { id: string; text?: string; username?: string; timestamp?: string }[] }>(d.http, `${GRAPH()}/${post.id}/comments?fields=id,text,username,timestamp&limit=50&access_token=${encodeURIComponent(conn.secrets.accessToken)}`, "Instagram");
    return r.data.filter((c) => c.text).map((c) => ({ externalId: c.id, authorHandle: c.username ?? null, authorName: c.username ?? null, text: c.text!, commentedAt: c.timestamp ? new Date(c.timestamp) : null, url: post.url ?? null }));
  },
  async threads(d, conn, post) {
    const r = await graphGet<{ data: { id: string; text?: string; username?: string; timestamp?: string; permalink?: string }[] }>(d.http, `${THREADS}/${post.id}/replies?fields=id,text,username,timestamp,permalink&access_token=${encodeURIComponent(conn.secrets.accessToken)}`, "Threads");
    return r.data.filter((c) => c.text).map((c) => ({ externalId: c.id, authorHandle: c.username ?? null, authorName: c.username ?? null, text: c.text!, commentedAt: c.timestamp ? new Date(c.timestamp) : null, url: c.permalink ?? null }));
  },
  async bluesky(d, conn, post) {
    const s = await blueskySession(d.http, conn);
    const res = await d.http(`${s.service}/xrpc/app.bsky.feed.getPostThread?depth=1&uri=${encodeURIComponent(post.id!)}`, { headers: { Authorization: `Bearer ${s.accessJwt}` }, timeoutMs: 20_000 });
    assertOk(res, "Bluesky");
    type P = { uri: string; cid: string; author: { did: string; handle: string; displayName?: string }; record: { text?: string; createdAt?: string } };
    const data = parseJson<{ thread: { replies?: { post?: P }[] } }>(res, "Bluesky");
    return (data.thread.replies ?? [])
      .map((r) => r.post)
      .filter((p): p is P => !!p?.record?.text && p.author.did !== s.did)
      .map((p) => ({ externalId: p.uri, cid: p.cid, authorHandle: p.author.handle, authorName: p.author.displayName || p.author.handle, text: p.record.text!, commentedAt: p.record.createdAt ? new Date(p.record.createdAt) : null, url: `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split("/").pop()}` }));
  },
  async mastodon(d, conn, post) {
    const ctx = parseJson<{ descendants: { id: string; in_reply_to_id: string | null; content: string; url?: string; created_at: string; account: { acct: string; display_name?: string } }[] }>(await mastodonFetch(d, conn, `/api/v1/statuses/${post.id}/context`), "Mastodon");
    return ctx.descendants
      .filter((s) => s.in_reply_to_id === post.id)
      .map((s) => ({ externalId: s.id, authorHandle: s.account.acct, authorName: s.account.display_name || s.account.acct, text: htmlToText(s.content), commentedAt: new Date(s.created_at), url: s.url ?? null }));
  },
};

export const REPLIERS: Record<string, (d: PublishDeps, conn: Connection, post: SocialPublishResult, comment: CommentRef, text: string) => Promise<{ id: string | null }>> = {
  async facebook(d, conn, _post, comment, text) {
    const r = await graphPost<{ id: string }>(d.http, `${GRAPH()}/${comment.externalId}/comments`, { message: text, access_token: conn.secrets.accessToken }, "Facebook");
    return { id: r.id };
  },
  async instagram(d, conn, _post, comment, text) {
    const r = await graphPost<{ id: string }>(d.http, `${GRAPH()}/${comment.externalId}/replies`, { message: text, access_token: conn.secrets.accessToken }, "Instagram");
    return { id: r.id };
  },
  async threads(d, conn, _post, comment, text) {
    const r = await threadsPublish(d.http, conn.secrets.accessToken, { media_type: "TEXT", text: truncate(text, 500), reply_to_id: comment.externalId });
    return { id: r.id };
  },
  async bluesky(d, conn, post, comment, text) {
    if (!post.id || !post.cid || !comment.cid) throw new ProviderHttpError("Missing Bluesky post reference for reply", 400, false);
    const s = await blueskySession(d.http, conn);
    const r = await blueskyPost(d.http, s, truncate(text, 300), { root: { uri: post.id, cid: post.cid }, parent: { uri: comment.externalId, cid: comment.cid } });
    return { id: r.uri };
  },
  async mastodon(d, conn, _post, comment, text) {
    const mention = comment.authorHandle ? `@${comment.authorHandle} ` : "";
    const r = parseJson<{ id: string }>(await mastodonFetch(d, conn, "/api/v1/statuses", { method: "POST", body: { status: truncate(`${mention}${text}`, 500), in_reply_to_id: comment.externalId, visibility: "public" } }), "Mastodon");
    return { id: r.id };
  },
};

export const METRICS_FETCHERS: Record<string, (d: PublishDeps, conn: Connection, post: SocialPublishResult) => Promise<SocialMetrics>> = {
  async facebook(d, conn, post) {
    const r = await graphGet<{ shares?: { count?: number }; reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } }>(
      d.http,
      `${GRAPH()}/${post.id}?fields=shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)&access_token=${encodeURIComponent(conn.secrets.accessToken)}`,
      "Facebook",
    );
    return { likes: r.reactions?.summary?.total_count ?? 0, comments: r.comments?.summary?.total_count ?? 0, shares: r.shares?.count ?? 0 };
  },
  async instagram(d, conn, post) {
    const r = await graphGet<{ like_count?: number; comments_count?: number }>(d.http, `${GRAPH()}/${post.id}?fields=like_count,comments_count&access_token=${encodeURIComponent(conn.secrets.accessToken)}`, "Instagram");
    return { likes: r.like_count ?? 0, comments: r.comments_count ?? 0, shares: 0 };
  },
  async threads(d, conn, post) {
    const r = await graphGet<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(d.http, `${THREADS}/${post.id}/insights?metric=views,likes,replies,reposts,quotes&access_token=${encodeURIComponent(conn.secrets.accessToken)}`, "Threads");
    const v = (n: string) => {
      const m = r.data.find((x) => x.name === n);
      return m?.total_value?.value ?? m?.values?.[0]?.value ?? 0;
    };
    return { likes: v("likes"), comments: v("replies"), shares: v("reposts") + v("quotes"), views: v("views") };
  },
  async bluesky(d, conn, post) {
    const s = await blueskySession(d.http, conn);
    const res = await d.http(`${s.service}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(post.id!)}`, { headers: { Authorization: `Bearer ${s.accessJwt}` }, timeoutMs: 20_000 });
    assertOk(res, "Bluesky");
    const p = parseJson<{ posts: { likeCount?: number; replyCount?: number; repostCount?: number; quoteCount?: number }[] }>(res, "Bluesky").posts[0] ?? {};
    return { likes: p.likeCount ?? 0, comments: p.replyCount ?? 0, shares: (p.repostCount ?? 0) + (p.quoteCount ?? 0) };
  },
  async mastodon(d, conn, post) {
    const s = parseJson<{ favourites_count?: number; replies_count?: number; reblogs_count?: number }>(await mastodonFetch(d, conn, `/api/v1/statuses/${post.id}`), "Mastodon");
    return { likes: s.favourites_count ?? 0, comments: s.replies_count ?? 0, shares: s.reblogs_count ?? 0 };
  },
};

export const engagementOf = (m: SocialMetrics | null | undefined) => (m ? m.likes + 2 * m.comments + 3 * m.shares : 0);

/** Read-only connection checks (no posting). */
export async function testPlatform(d: PublishDeps, platform: string, conn: Connection): Promise<{ ok: boolean; message: string }> {
  const get = async (url: string, name: string, headers: Record<string, string> = {}) => {
    const res = await d.http(url, { headers, timeoutMs: 15_000, retries: 0 });
    assertOk(res, name);
    return res;
  };
  switch (platform) {
    case "facebook": {
      const r = parseJson<{ name?: string }>(await get(`${GRAPH()}/${encodeURIComponent(conn.settings.pageId)}?fields=name&access_token=${encodeURIComponent(conn.secrets.accessToken)}`, "Facebook"), "Facebook");
      return { ok: true, message: `Page “${r.name ?? conn.settings.pageId}”` };
    }
    case "instagram": {
      const r = parseJson<{ username?: string }>(await get(`${GRAPH()}/${encodeURIComponent(conn.settings.igUserId)}?fields=username&access_token=${encodeURIComponent(conn.secrets.accessToken)}`, "Instagram"), "Instagram");
      return { ok: true, message: `@${r.username ?? conn.settings.igUserId}` };
    }
    case "threads": {
      const r = parseJson<{ username?: string }>(await get(`${THREADS}/me?fields=username&access_token=${encodeURIComponent(conn.secrets.accessToken)}`, "Threads"), "Threads");
      return { ok: true, message: `@${r.username ?? "me"}` };
    }
    case "bluesky": {
      const s = await blueskySession(d.http, conn);
      return { ok: true, message: `Logged in as @${s.handle}` };
    }
    case "mastodon": {
      const res = await mastodonFetch(d, conn, "/api/v1/accounts/verify_credentials");
      return { ok: true, message: `@${parseJson<{ acct?: string }>(res, "Mastodon").acct ?? "me"}` };
    }
    case "telegram": {
      const r = await telegramCall<{ username?: string }>(d.http, conn.secrets.botToken, "getMe", {});
      return { ok: true, message: `Bot @${r.username}` };
    }
    case "discord": {
      if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//.test(conn.secrets.webhookUrl ?? "")) return { ok: false, message: "Not a Discord webhook URL" };
      const r = parseJson<{ name?: string }>(await get(conn.secrets.webhookUrl, "Discord"), "Discord");
      return { ok: true, message: `Webhook “${r.name ?? "webhook"}”` };
    }
    case "linkedin": {
      const r = parseJson<{ name?: string }>(await get("https://api.linkedin.com/v2/userinfo", "LinkedIn", { Authorization: `Bearer ${conn.secrets.accessToken}` }), "LinkedIn");
      return { ok: true, message: r.name ?? "Token valid" };
    }
    default:
      return { ok: false, message: "Unknown platform" };
  }
}
