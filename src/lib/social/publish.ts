import { assertOk, parseJson, ProviderHttpError, type HttpClient } from "@/lib/providers/http";
import { safeFetch, type Resolver } from "@/lib/analysis/net";
import { LINK_TOKEN } from "./ai";
import type { Connection } from "./accounts";

export type PostContent = { body: string; shortBody: string; hashtags: string[]; imageUrl: string | null; link: string };
export type PublishOutcome = { id: string | null; url: string | null };
export type PublishDeps = { http: HttpClient; resolve: Resolver };

const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;

/** Character limits for short-form platforms (Bluesky counts graphemes; this is close enough for our text). */
export const LIMITS: Record<string, number> = { bluesky: 300, threads: 500, mastodon: 500, discord: 2000, telegram: 4096, instagram: 2200, linkedin: 3000, facebook: 5000 };
const SHORT = new Set(["bluesky", "threads", "mastodon"]);

function truncate(s: string, max: number) {
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** Final text for one platform: pick long/short body, place the link, add hashtags if they fit. */
export function composeText(platform: string, c: PostContent): string {
  const max = LIMITS[platform] ?? 2000;
  const linkText = platform === "instagram" ? "link in bio 🔗" : c.link;
  let text = (SHORT.has(platform) ? c.shortBody : c.body).trim();
  text = c.link || platform === "instagram" ? text.split(LINK_TOKEN).join(linkText) : text.replace(new RegExp(`\\s*\\S*\\s*${LINK_TOKEN.replace(/[{}]/g, "\\$&")}`, "g"), "").trim();
  const tags = c.hashtags.map((h) => `#${h}`).join(" ");
  if (tags && platform !== "discord" && Array.from(`${text}\n\n${tags}`).length <= max) text = `${text}\n\n${tags}`;
  if (Array.from(text).length > max) {
    // Keep the link visible when truncating.
    const tail = c.link && text.includes(c.link) ? ` ${c.link}` : "";
    text = truncate(tail ? text.replace(c.link, "").trim() : text, max - Array.from(tail).length) + tail;
  }
  return text;
}

function form(data: Record<string, string>) {
  return new URLSearchParams(data).toString();
}

async function graphPost<T>(http: HttpClient, url: string, data: Record<string, string>, name: string) {
  const res = await http(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(data), timeoutMs: 30_000, retries: 1 });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (JSON.parse(res.text) as { error?: { message?: string } }).error?.message ?? "";
    } catch {}
    throw new ProviderHttpError(`${name} responded with HTTP ${res.status}${detail ? `: ${detail}` : ""}`, res.status, res.status === 429 || res.status >= 500);
  }
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
  return facets;
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
    const r = await graphPost<{ id: string }>(d.http, `${GRAPH()}/${page}/feed`, { message: text, ...(c.link ? { link: c.link } : {}), access_token: token }, "Facebook");
    return { id: r.id, url: `https://www.facebook.com/${r.id}` };
  },

  async instagram(d, conn, c) {
    const image = c.imageUrl || conn.settings.defaultImageUrl;
    if (!image) throw new ProviderHttpError("Instagram needs an image: add an image URL to the post or a default image in the Instagram connection", 400, false);
    const user = encodeURIComponent(conn.settings.igUserId);
    const token = conn.secrets.accessToken;
    const container = await graphPost<{ id: string }>(d.http, `${GRAPH()}/${user}/media`, { image_url: image, caption: composeText("instagram", c), access_token: token }, "Instagram");
    const pub = await graphPost<{ id: string }>(d.http, `${GRAPH()}/${user}/media_publish`, { creation_id: container.id, access_token: token }, "Instagram");
    let url: string | null = null;
    try {
      const res = await d.http(`${GRAPH()}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`, { timeoutMs: 15_000, retries: 0 });
      if (res.ok) url = parseJson<{ permalink?: string }>(res, "Instagram").permalink ?? null;
    } catch {}
    return { id: pub.id, url };
  },

  async threads(d, conn, c) {
    const token = conn.secrets.accessToken;
    const base = "https://graph.threads.net/v1.0/me";
    const container = await graphPost<{ id: string }>(d.http, `${base}/threads`, { media_type: c.imageUrl ? "IMAGE" : "TEXT", text: composeText("threads", c), ...(c.imageUrl ? { image_url: c.imageUrl } : {}), access_token: token }, "Threads");
    const pub = await graphPost<{ id: string }>(d.http, `${base}/threads_publish`, { creation_id: container.id, access_token: token }, "Threads");
    let url: string | null = null;
    try {
      const res = await d.http(`https://graph.threads.net/v1.0/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`, { timeoutMs: 15_000, retries: 0 });
      if (res.ok) url = parseJson<{ permalink?: string }>(res, "Threads").permalink ?? null;
    } catch {}
    return { id: pub.id, url };
  },

  async bluesky(d, conn, c) {
    const s = await blueskySession(d.http, conn);
    const text = composeText("bluesky", c);
    const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), langs: ["en"] };
    const facets = blueskyFacets(text);
    if (facets.length) record.facets = facets;
    const res = await d.http(`${s.service}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.accessJwt}` },
      body: JSON.stringify({ repo: s.did, collection: "app.bsky.feed.post", record }),
      timeoutMs: 20_000,
    });
    assertOk(res, "Bluesky");
    const r = parseJson<{ uri: string }>(res, "Bluesky");
    return { id: r.uri, url: `https://bsky.app/profile/${s.handle}/post/${r.uri.split("/").pop()}` };
  },

  async mastodon(d, conn, c) {
    const base = conn.settings.instanceUrl.replace(/\/+$/, "");
    if (!/^https:\/\//.test(base)) throw new ProviderHttpError("Mastodon instance URL must start with https://", 400, false);
    const res = await safeFetch(d.http, d.resolve, `${base}/api/v1/statuses`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${conn.secrets.accessToken}` },
      body: form({ status: composeText("mastodon", c), visibility: "public" }),
      timeoutMs: 20_000,
    });
    assertOk(res, "Mastodon");
    const r = parseJson<{ id: string; url?: string }>(res, "Mastodon");
    return { id: r.id, url: r.url ?? null };
  },

  async telegram(d, conn, c) {
    const res = await d.http(`https://api.telegram.org/bot${conn.secrets.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: conn.settings.chatId, text: composeText("telegram", c) }),
      timeoutMs: 20_000,
    });
    const r = parseJson<{ ok: boolean; description?: string; result?: { message_id: number } }>(res, "Telegram");
    if (!r.ok || !r.result) throw new ProviderHttpError(`Telegram: ${r.description ?? `HTTP ${res.status}`}`, res.status, res.status === 429 || res.status >= 500);
    const chat = conn.settings.chatId.startsWith("@") ? conn.settings.chatId.slice(1) : null;
    return { id: String(r.result.message_id), url: chat ? `https://t.me/${chat}/${r.result.message_id}` : null };
  },

  async discord(d, conn, c) {
    const hook = conn.secrets.webhookUrl;
    if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//.test(hook ?? "")) throw new ProviderHttpError("Discord webhook URL must be a https://discord.com/api/webhooks/… URL", 400, false);
    const res = await d.http(`${hook}${hook.includes("?") ? "&" : "?"}wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: composeText("discord", c) }),
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
    const content = c.link
      ? { shareCommentary: { text }, shareMediaCategory: "ARTICLE", media: [{ status: "READY", originalUrl: c.link }] }
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
      const r = parseJson<{ username?: string }>(await get(`https://graph.threads.net/v1.0/me?fields=username&access_token=${encodeURIComponent(conn.secrets.accessToken)}`, "Threads"), "Threads");
      return { ok: true, message: `@${r.username ?? "me"}` };
    }
    case "bluesky": {
      const s = await blueskySession(d.http, conn);
      return { ok: true, message: `Logged in as @${s.handle}` };
    }
    case "mastodon": {
      const base = conn.settings.instanceUrl.replace(/\/+$/, "");
      const res = await safeFetch(d.http, d.resolve, `${base}/api/v1/accounts/verify_credentials`, { headers: { Authorization: `Bearer ${conn.secrets.accessToken}` }, timeoutMs: 15_000 });
      assertOk(res, "Mastodon");
      return { ok: true, message: `@${parseJson<{ acct?: string }>(res, "Mastodon").acct ?? "me"}` };
    }
    case "telegram": {
      const r = parseJson<{ ok: boolean; result?: { username?: string } }>(await get(`https://api.telegram.org/bot${conn.secrets.botToken}/getMe`, "Telegram"), "Telegram");
      return { ok: r.ok, message: r.ok ? `Bot @${r.result?.username}` : "Telegram rejected the bot token" };
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
