import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { assertOk, parseJson, ProviderHttpError, type HttpClient } from "@/lib/providers/http";
import { schema, withTenant } from "@/lib/db";
import { hmacSha256, randomToken } from "@/lib/security/crypto";
import { httpClient } from "@/lib/services/integrations";
import { GOOGLE_ACCOUNT, getConnection, googleClient, updateConnectionSecrets, type Connection } from "./accounts";
import { googleAccessToken } from "./publish-more";
import { platformName } from "./format";

/** Scopes requested by "Sign in with Google". drive.file only reaches files this app creates. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/blogger",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/webmasters",
  "https://www.googleapis.com/auth/drive.file",
];

export const GOOGLE_STATE_COOKIE = "lo_google_oauth";

export function googleRedirectUri() {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/social/google/callback`;
}

function key() {
  const k = process.env.APP_ENCRYPTION_KEY;
  if (!k) throw new Error("APP_ENCRYPTION_KEY is not set");
  return k;
}

/** Signed, expiring OAuth state bound to the workspace, the user and a cookie nonce. */
export function signGoogleState(workspaceId: string, userId: string, nonce: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ w: workspaceId, u: userId, n: nonce, e: now + 10 * 60_000 })).toString("base64url");
  return `${payload}.${hmacSha256(key(), `google-state:${payload}`)}`;
}

export function verifyGoogleState(state: string, nonce: string | undefined, now = Date.now()) {
  const [payload, sig] = state.split(".");
  if (!payload || !sig || !nonce) return null;
  const expected = Buffer.from(hmacSha256(key(), `google-state:${payload}`));
  if (expected.length !== sig.length || !timingSafeEqual(expected, Buffer.from(sig))) return null;
  const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as { w: string; u: string; n: string; e: number };
  if (s.e < now || s.n !== nonce) return null;
  return { workspaceId: s.w, userId: s.u };
}

export async function googleAuthStart(workspaceId: string, userId: string) {
  const conn = await getConnection(workspaceId, GOOGLE_ACCOUNT);
  const { clientId } = googleClient(conn.secrets);
  if (!clientId) throw new ProviderHttpError("Add your Google OAuth client ID and secret first (or set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)", 400, false);
  const nonce = randomToken(16);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // Always show consent so Google returns a refresh token.
    prompt: "consent",
    include_granted_scopes: "true",
    state: signGoogleState(workspaceId, userId, nonce),
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, nonce };
}

/** Exchange the authorization code and store the refresh token on the shared Google account. */
export async function googleAuthFinish(workspaceId: string, code: string, http: HttpClient = httpClient()) {
  const conn = await getConnection(workspaceId, GOOGLE_ACCOUNT);
  const { clientId, clientSecret } = googleClient(conn.secrets);
  const res = await http("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: googleRedirectUri(), grant_type: "authorization_code" }).toString(),
    timeoutMs: 20_000,
  });
  const t = parseJson<{ access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string }>(res, "Google OAuth");
  if (!res.ok || !t.access_token) throw new ProviderHttpError(`Google sign-in failed: ${t.error_description ?? t.error ?? `HTTP ${res.status}`}`, res.status, false);
  if (!t.refresh_token) throw new ProviderHttpError("Google did not return a refresh token. Remove LeadOrbit from myaccount.google.com/permissions and sign in again.", 400, false);
  const me = await http("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` }, timeoutMs: 15_000 });
  const email = me.ok ? (parseJson<{ email?: string }>(me, "Google").email ?? "") : "";
  await updateConnectionSecrets(workspaceId, GOOGLE_ACCOUNT, { refreshToken: t.refresh_token, email, scopes: t.scope ?? "" });
  await withTenant(workspaceId, (tx) => tx.update(schema.integrations).set({ enabled: true, connectionStatus: "connected", lastTestedAt: new Date(), lastSuccessAt: new Date(), lastError: null }).where(and(eq(schema.integrations.workspaceId, workspaceId), eq(schema.integrations.providerId, "social:google"))));
  return { email };
}

type Deps = { http: HttpClient };

/** Shared Google sign-in as a connection with OAuth client fields filled in, or null. */
export async function googleAccount(workspaceId: string): Promise<Connection | null> {
  const conn = await getConnection(workspaceId, GOOGLE_ACCOUNT);
  if (!conn.secrets.refreshToken) return null;
  return { ...conn, secrets: { ...conn.secrets, ...googleClient(conn.secrets) } };
}

const token = (d: Deps, conn: Connection) => googleAccessToken({ http: d.http, resolve: async () => [] }, conn);

/* --------------------------- Search Console ---------------------------- */

export type SeoQuery = { query: string; clicks: number; impressions: number; ctr: number; position: number };
export type SeoInsights = { site: string; from: string; to: string; top: SeoQuery[]; opportunities: SeoQuery[] };

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Last 28 days of queries (Search Console data lags ~3 days). "Opportunities" are queries with
 * many impressions on positions 5–20 and a low click-through rate: the best SEO keywords to target.
 */
export async function searchConsoleInsights(d: Deps, conn: Connection, now = new Date()): Promise<SeoInsights> {
  const site = conn.settings.searchConsoleSite?.trim();
  if (!site) throw new ProviderHttpError("Set the Search Console property in the Google account settings", 400, false);
  const to = new Date(now.getTime() - 3 * 86400_000);
  const from = new Date(to.getTime() - 28 * 86400_000);
  const res = await d.http(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(d, conn)}` },
    body: JSON.stringify({ startDate: day(from), endDate: day(to), dimensions: ["query"], rowLimit: 250 }),
    timeoutMs: 30_000,
  });
  assertOk(res, "Search Console");
  const rows = (parseJson<{ rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }>(res, "Search Console").rows ?? []).map((r) => ({
    query: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: Math.round(r.ctr * 1000) / 10,
    position: Math.round(r.position * 10) / 10,
  }));
  const top = [...rows].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 15);
  const opportunities = rows
    .filter((r) => r.impressions >= 20 && r.position >= 4.5 && r.position <= 20 && r.ctr < 5)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15);
  return { site, from: day(from), to: day(to), top, opportunities };
}

/** Ask Google to re-read the sitemap after new blog posts. */
export async function submitSitemap(d: Deps, conn: Connection) {
  const site = conn.settings.searchConsoleSite?.trim();
  const sitemap = conn.settings.sitemapUrl?.trim();
  if (!site || !sitemap) return false;
  const res = await d.http(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/sitemaps/${encodeURIComponent(sitemap)}`, { method: "PUT", headers: { Authorization: `Bearer ${await token(d, conn)}` }, timeoutMs: 20_000 });
  assertOk(res, "Search Console sitemap");
  return true;
}

/* ------------------------------ YouTube -------------------------------- */

/** Most-viewed recent videos for each keyword (search costs 100 quota units, so max 3 keywords). */
export async function youtubeTrends(d: Deps, conn: Connection, keywords: string[], since: Date) {
  const auth = { Authorization: `Bearer ${await token(d, conn)}` };
  const items: { id: string; title: string; description: string; publishedAt: string; channel: string }[] = [];
  for (const kw of keywords.slice(0, 3)) {
    const res = await d.http(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=viewCount&maxResults=10&publishedAfter=${encodeURIComponent(since.toISOString())}&q=${encodeURIComponent(kw)}`, { headers: auth, timeoutMs: 20_000 });
    assertOk(res, "YouTube");
    for (const it of parseJson<{ items: { id: { videoId: string }; snippet: { title: string; description: string; publishedAt: string; channelTitle: string } }[] }>(res, "YouTube").items)
      items.push({ id: it.id.videoId, title: it.snippet.title, description: it.snippet.description, publishedAt: it.snippet.publishedAt, channel: it.snippet.channelTitle });
  }
  const ids = [...new Set(items.map((i) => i.id))];
  const stats = new Map<string, number>();
  if (ids.length) {
    const res = await d.http(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.slice(0, 50).join(",")}`, { headers: auth, timeoutMs: 20_000 });
    if (res.ok)
      for (const v of parseJson<{ items: { id: string; statistics: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(res, "YouTube").items)
        stats.set(v.id, Math.round(Number(v.statistics.viewCount ?? 0) / 100) + Number(v.statistics.likeCount ?? 0) + Number(v.statistics.commentCount ?? 0));
  }
  const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  return items.map((i) => ({ sourceId: "youtube", externalId: `yt:${i.id}`, title: decode(i.title), summary: decode(i.description).slice(0, 800) || null, url: `https://www.youtube.com/watch?v=${i.id}`, publishedAt: new Date(i.publishedAt), engagement: stats.get(i.id) ?? 0 }));
}

/* --------------------------- Google Sheets ----------------------------- */

const POSTS_HEADER = ["Published", "Title", "Platforms", "Status", "Links", "Your link", "Source"];
const METRICS_HEADER = ["Published", "Title", "Platform", "Likes", "Comments", "Shares", "Views", "URL"];

/** Create the report spreadsheet once (drive.file scope: only this file is accessible). */
export async function ensureSpreadsheet(workspaceId: string, d: Deps, conn: Connection) {
  if (conn.secrets.spreadsheetId) return conn.secrets.spreadsheetId;
  const res = await d.http("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(d, conn)}` },
    body: JSON.stringify({ properties: { title: "LeadOrbit social report" }, sheets: [{ properties: { title: "Posts" } }, { properties: { title: "Metrics" } }] }),
    timeoutMs: 20_000,
  });
  assertOk(res, "Google Sheets");
  const s = parseJson<{ spreadsheetId: string; spreadsheetUrl: string }>(res, "Google Sheets");
  await appendRows(d, conn, s.spreadsheetId, "Posts", [POSTS_HEADER]);
  await updateConnectionSecrets(workspaceId, GOOGLE_ACCOUNT, { spreadsheetId: s.spreadsheetId, spreadsheetUrl: s.spreadsheetUrl });
  conn.secrets.spreadsheetId = s.spreadsheetId;
  return s.spreadsheetId;
}

async function appendRows(d: Deps, conn: Connection, id: string, sheet: string, values: (string | number)[][]) {
  const res = await d.http(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${sheet}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(d, conn)}` },
    body: JSON.stringify({ values }),
    timeoutMs: 20_000,
  });
  assertOk(res, "Google Sheets");
}

type PostRow = typeof schema.socialPosts.$inferSelect;

export async function logPostToSheet(workspaceId: string, d: Deps, conn: Connection, post: PostRow, link: string) {
  const id = await ensureSpreadsheet(workspaceId, d, conn);
  const links = post.platforms.map((p) => `${platformName(p)}: ${post.results[p]?.ok ? (post.results[p]?.url ?? "posted") : `failed (${post.results[p]?.error ?? "?"})`}`).join("\n");
  await appendRows(d, conn, id, "Posts", [[(post.publishedAt ?? new Date()).toISOString().replace("T", " ").slice(0, 16), post.hook, post.platforms.map(platformName).join(", "), post.status, links, link, post.sourceUrl ?? post.sourceId]]);
}

/** Rewrite the Metrics tab with the latest numbers for recent posts. */
export async function writeMetricsSheet(workspaceId: string, d: Deps, conn: Connection, posts: PostRow[]) {
  const id = await ensureSpreadsheet(workspaceId, d, conn);
  const auth = { Authorization: `Bearer ${await token(d, conn)}` };
  const rows: (string | number)[][] = [METRICS_HEADER];
  for (const p of posts)
    for (const [platform, r] of Object.entries(p.results))
      if (r.ok) rows.push([(p.publishedAt ?? new Date()).toISOString().slice(0, 10), p.hook, platformName(platform), r.metrics?.likes ?? "", r.metrics?.comments ?? "", r.metrics?.shares ?? "", r.metrics?.views ?? "", r.url ?? ""]);
  const clear = await d.http(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent("Metrics!A:H")}:clear`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{}", timeoutMs: 20_000 });
  assertOk(clear, "Google Sheets");
  const res = await d.http(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`Metrics!A1:H${rows.length}`)}?valueInputOption=RAW`, { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ values: rows }), timeoutMs: 20_000 });
  assertOk(res, "Google Sheets");
  return rows.length - 1;
}
