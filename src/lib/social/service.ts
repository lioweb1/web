import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import type { SocialAutopilotConfig, SocialPublishResult } from "@/lib/db/schema";
import { httpClient } from "@/lib/services/integrations";
import { defaultResolver, type Resolver } from "@/lib/analysis/net";
import { enqueue } from "@/lib/jobs/queue";
import { notify } from "@/lib/notifications/notify";
import { AI_PROVIDERS, SOCIAL_PLATFORMS, getConnection, getConnectionDef, recordConnectionStatus, type SocialConnectionDef } from "./accounts";
import { generatePost, testAi, type TrendInput } from "./ai";
import { PUBLISHERS, testPlatform, type PostContent } from "./publish";
import { ProviderHttpError } from "@/lib/providers/http";
import { fetchTrends, TREND_SOURCES } from "./trends";

export const DEFAULT_CONFIG: SocialAutopilotConfig = {
  keywords: [],
  sources: ["hackernews", "google_news", "reddit"],
  subreddits: [],
  feeds: [],
  platforms: [],
  aiProvider: "gemini",
  brandName: "",
  brandVoice: "",
  link: "",
  language: "English",
  mode: "approve",
  maxPostsPerDay: 4,
  draftsPerScan: 3,
};

export const MIN_INTERVAL_MINUTES = 30;

/** Errors caused by missing or invalid user configuration; safe to show and not worth retrying. */
export class SocialConfigError extends Error {}

let resolverOverride: Resolver | null = null;
export function setSocialResolverForTests(r: Resolver | null) {
  resolverOverride = r;
}
const deps = () => ({ http: httpClient(), resolve: resolverOverride ?? defaultResolver });

export type Post = typeof schema.socialPosts.$inferSelect;

export async function getAutopilot(workspaceId: string) {
  const [row] = await withTenant(workspaceId, (tx) => tx.select().from(schema.socialAutopilots).where(eq(schema.socialAutopilots.workspaceId, workspaceId)));
  return { active: row?.active ?? false, intervalMinutes: row?.intervalMinutes ?? 180, config: { ...DEFAULT_CONFIG, ...row?.config }, lastRunAt: row?.lastRunAt ?? null, lastError: row?.lastError ?? null, lastRunStats: row?.lastRunStats ?? null, nextRunAt: row?.nextRunAt ?? null };
}

export function validateConfig(cfg: SocialAutopilotConfig, active: boolean) {
  const errors: string[] = [];
  if (!AI_PROVIDERS.some((p) => p.id === cfg.aiProvider)) errors.push("Choose an AI writer");
  if (cfg.sources.some((s) => !TREND_SOURCES.some((t) => t.id === s))) errors.push("Unknown trend source");
  if (cfg.platforms.some((p) => !SOCIAL_PLATFORMS.some((s) => s.id === p))) errors.push("Unknown platform");
  if (cfg.link && !/^https?:\/\/\S+$/.test(cfg.link)) errors.push("Link must start with http:// or https://");
  if (cfg.feeds.some((f) => !/^https?:\/\/\S+$/.test(f))) errors.push("Every RSS feed must be an http(s) URL");
  if (active) {
    if (!cfg.keywords.length) errors.push("Add at least one niche keyword");
    if (!cfg.sources.length) errors.push("Choose at least one trend source");
    if (!cfg.platforms.length) errors.push("Choose at least one platform");
    if (cfg.sources.includes("rss") && !cfg.feeds.length) errors.push("Add at least one RSS feed or untick “Your RSS feeds”");
  }
  return errors;
}

export async function saveAutopilot(workspaceId: string, input: { active: boolean; intervalMinutes: number; config: SocialAutopilotConfig }) {
  const errors = validateConfig(input.config, input.active);
  if (errors.length) throw new SocialConfigError(errors.join(". "));
  const intervalMinutes = Math.max(MIN_INTERVAL_MINUTES, input.intervalMinutes);
  await withTenant(workspaceId, async (tx) => {
    const [existing] = await tx.select().from(schema.socialAutopilots).where(eq(schema.socialAutopilots.workspaceId, workspaceId));
    // Start soon after activation; otherwise keep the schedule.
    const nextRunAt = input.active ? (existing?.active && existing.nextRunAt ? existing.nextRunAt : new Date(Date.now() + 60_000)) : null;
    const values = { active: input.active, intervalMinutes, config: input.config, nextRunAt, updatedAt: new Date() };
    if (existing) await tx.update(schema.socialAutopilots).set(values).where(eq(schema.socialAutopilots.workspaceId, workspaceId));
    else await tx.insert(schema.socialAutopilots).values({ workspaceId, ...values });
  });
}

async function requireAi(workspaceId: string, providerId: string) {
  const def = getConnectionDef("ai", providerId);
  if (!def) throw new SocialConfigError("Choose an AI writer in Social autopilot settings");
  const conn = await getConnection(workspaceId, def);
  if (!conn.configured) throw new SocialConfigError(`${def.name} is not configured. Add its API key under Social autopilot → Connections.`);
  return { def, conn };
}

async function insertDraft(workspaceId: string, cfg: SocialAutopilotConfig, trend: TrendInput & { sourceId: string; externalId: string | null }, opts: { imageUrl?: string | null; platforms?: string[] } = {}) {
  const { def, conn } = await requireAi(workspaceId, cfg.aiProvider);
  let gen;
  try {
    gen = await generatePost(httpClient(), def.id, conn, cfg, trend);
    await recordConnectionStatus(workspaceId, def, { ok: true, message: "ok" });
  } catch (e) {
    await recordConnectionStatus(workspaceId, def, { ok: false, message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  const [row] = await withTenant(workspaceId, (tx) =>
    tx
      .insert(schema.socialPosts)
      .values({
        workspaceId,
        sourceId: trend.sourceId,
        sourceExternalId: trend.externalId,
        sourceTitle: trend.title.slice(0, 500),
        sourceUrl: trend.url ?? null,
        ...gen,
        imageUrl: opts.imageUrl ?? null,
        platforms: opts.platforms ?? cfg.platforms,
        aiProvider: def.id,
      })
      .onConflictDoNothing()
      .returning(),
  );
  return row ?? null;
}

/** Turn pasted text (a post, keywords, an idea) into a draft. */
export async function generateFromText(workspaceId: string, input: { text: string; url?: string | null; imageUrl?: string | null; platforms?: string[] }) {
  const { config } = await getAutopilot(workspaceId);
  const text = input.text.trim();
  if (text.length < 3) throw new SocialConfigError("Paste some text, keywords or an idea first");
  const post = await insertDraft(workspaceId, config, { title: text.slice(0, 300), summary: text.length > 300 ? text : null, url: input.url ?? null, sourceName: "the user", sourceId: "manual", externalId: null }, { imageUrl: input.imageUrl, platforms: input.platforms?.length ? input.platforms : config.platforms });
  return post!;
}

export async function publishedInLast24h(workspaceId: string, now = new Date()) {
  const [{ n }] = await withTenant(workspaceId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.socialPosts)
      .where(and(eq(schema.socialPosts.workspaceId, workspaceId), inArray(schema.socialPosts.status, ["queued", "publishing", "published", "partial"]), gte(sql`coalesce(${schema.socialPosts.publishedAt}, ${schema.socialPosts.updatedAt})`, new Date(now.getTime() - 86400_000)))),
  );
  return n;
}

/** One autopilot pass: find trends, draft posts, and in auto mode queue them for publishing. */
export async function runScan(workspaceId: string, now = new Date()) {
  const ap = await getAutopilot(workspaceId);
  const cfg = ap.config;
  const stats = { fetched: 0, candidates: 0, drafted: 0, queued: 0, skippedDailyLimit: 0, errors: 0 };
  const errors: string[] = [];
  try {
    if (!cfg.keywords.length) throw new SocialConfigError("Add niche keywords before scanning");
    await requireAi(workspaceId, cfg.aiProvider);
    const bsky = cfg.sources.includes("bluesky") ? await getConnection(workspaceId, getConnectionDef("platform", "bluesky")!) : null;
    const trends = await fetchTrends({ ...deps(), bluesky: bsky }, cfg, now);
    stats.fetched = trends.fetched;
    errors.push(...trends.errors);
    const used = new Set(
      trends.items.length
        ? (await withTenant(workspaceId, (tx) => tx.select({ id: schema.socialPosts.sourceExternalId }).from(schema.socialPosts).where(and(eq(schema.socialPosts.workspaceId, workspaceId), inArray(schema.socialPosts.sourceExternalId, trends.items.map((i) => i.externalId)))))).map((r) => r.id)
        : [],
    );
    const fresh = trends.items.filter((i) => !used.has(i.externalId));
    stats.candidates = fresh.length;
    let budget = cfg.mode === "auto" ? Math.max(0, cfg.maxPostsPerDay - (await publishedInLast24h(workspaceId, now))) : Infinity;
    for (const item of fresh.slice(0, Math.max(1, Math.min(cfg.draftsPerScan, 10)))) {
      if (cfg.mode === "auto" && budget <= 0) {
        stats.skippedDailyLimit++;
        continue;
      }
      try {
        const name = TREND_SOURCES.find((s) => s.id === item.sourceId)?.name ?? item.sourceId;
        const post = await insertDraft(workspaceId, cfg, { ...item, sourceName: name });
        if (!post) continue;
        stats.drafted++;
        if (cfg.mode === "auto" && post.platforms.length) {
          await queuePublish(workspaceId, post.id);
          stats.queued++;
          budget--;
        }
      } catch (e) {
        stats.errors++;
        errors.push(`AI: ${e instanceof Error ? e.message : String(e)}`);
        // Missing config or an exhausted quota will fail every item the same way.
        if (e instanceof SocialConfigError || /HTTP 4(01|03|29)/.test(String(e))) break;
      }
    }
    if (stats.drafted && cfg.mode === "approve")
      await notify(workspaceId, { type: "announcement", title: `${stats.drafted} new social post draft${stats.drafted > 1 ? "s" : ""} ready for review`, body: "Open Social autopilot to approve, edit or reject them.", dedupeKey: `social:drafts:${now.toISOString().slice(0, 16)}` });
  } catch (e) {
    errors.unshift(e instanceof Error ? e.message : String(e));
  }
  stats.errors = Math.max(stats.errors, errors.length);
  await withTenant(workspaceId, (tx) =>
    tx
      .update(schema.socialAutopilots)
      .set({ lastRunAt: now, lastRunStats: stats, lastError: errors.length ? errors.join(" | ").slice(0, 1000) : null })
      .where(eq(schema.socialAutopilots.workspaceId, workspaceId)),
  );
  return { ...stats, errorMessages: errors };
}

export async function getPost(workspaceId: string, postId: string) {
  const [p] = await withTenant(workspaceId, (tx) => tx.select().from(schema.socialPosts).where(and(eq(schema.socialPosts.id, postId), eq(schema.socialPosts.workspaceId, workspaceId))));
  if (!p) throw new SocialConfigError("Post not found");
  return p;
}

export async function updatePost(workspaceId: string, postId: string, patch: { hook: string; body: string; shortBody: string; engagementComment: string; hashtags: string[]; imageUrl: string | null; platforms: string[] }) {
  const p = await getPost(workspaceId, postId);
  if (["queued", "publishing", "published"].includes(p.status)) throw new SocialConfigError("This post is already published or being published");
  if (patch.platforms.some((x) => !SOCIAL_PLATFORMS.some((s) => s.id === x))) throw new SocialConfigError("Unknown platform");
  await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ ...patch, updatedAt: new Date() }).where(eq(schema.socialPosts.id, postId)));
}

export async function queuePublish(workspaceId: string, postId: string) {
  const p = await getPost(workspaceId, postId);
  if (!p.platforms.length) throw new SocialConfigError("Choose at least one platform for this post");
  if (["queued", "publishing", "published"].includes(p.status)) throw new SocialConfigError("This post is already published or being published");
  await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ status: "queued", updatedAt: new Date() }).where(eq(schema.socialPosts.id, postId)));
  await enqueue({ type: "social_publish", workspaceId, payload: { postId }, idempotencyKey: `social:${postId}:${Date.now()}`, maxAttempts: 3 });
}

export async function setPostStatus(workspaceId: string, postId: string, status: "rejected" | "draft") {
  const p = await getPost(workspaceId, postId);
  if (["queued", "publishing", "published"].includes(p.status)) throw new SocialConfigError("This post is already published or being published");
  await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ status, updatedAt: new Date() }).where(eq(schema.socialPosts.id, postId)));
}

export async function deletePost(workspaceId: string, postId: string) {
  await withTenant(workspaceId, (tx) => tx.delete(schema.socialPosts).where(and(eq(schema.socialPosts.id, postId), eq(schema.socialPosts.workspaceId, workspaceId))));
}

/**
 * Publish a post to every selected platform that has not succeeded yet. Retries only failed
 * platforms, so a partial failure never double-posts. Throws if any platform still failed.
 */
export async function publishPost(workspaceId: string, postId: string, opts: { finalAttempt?: boolean } = {}) {
  const p = await getPost(workspaceId, postId);
  if (p.status === "published") return { skipped: true };
  const { config } = await getAutopilot(workspaceId);
  await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ status: "publishing", updatedAt: new Date() }).where(eq(schema.socialPosts.id, postId)));
  const content: PostContent = { body: p.body, shortBody: p.shortBody, hashtags: p.hashtags, imageUrl: p.imageUrl, link: config.link };
  const results: Record<string, SocialPublishResult> = { ...p.results };
  let retryable = false;
  for (const platform of p.platforms) {
    if (results[platform]?.ok) continue;
    const def = getConnectionDef("platform", platform);
    const at = new Date().toISOString();
    if (!def || !PUBLISHERS[platform]) {
      results[platform] = { ok: false, error: "Unknown platform", at };
      continue;
    }
    const conn = await getConnection(workspaceId, def);
    if (!conn.configured || !conn.enabled) {
      results[platform] = { ok: false, error: `${def.name} is not connected or is disabled`, at };
      continue;
    }
    try {
      const out = await PUBLISHERS[platform](deps(), conn, content);
      results[platform] = { ok: true, id: out.id, url: out.url, at };
      await recordConnectionStatus(workspaceId, def, { ok: true, message: "ok" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results[platform] = { ok: false, error: msg.slice(0, 500), at };
      if (!(e instanceof ProviderHttpError) || e.retryable) retryable = true;
      await recordConnectionStatus(workspaceId, def, { ok: false, message: msg });
    }
  }
  const okCount = p.platforms.filter((x) => results[x]?.ok).length;
  const failed = p.platforms.filter((x) => !results[x]?.ok);
  const status = failed.length === 0 ? "published" : okCount ? "partial" : "failed";
  // Bad tokens, missing images and similar errors will not fix themselves: stop retrying.
  const final = opts.finalAttempt || !retryable;
  await withTenant(workspaceId, (tx) =>
    tx
      .update(schema.socialPosts)
      .set({ results, status: failed.length && !final ? "publishing" : status, publishedAt: okCount && !p.publishedAt ? new Date() : p.publishedAt, updatedAt: new Date() })
      .where(eq(schema.socialPosts.id, postId)),
  );
  if (failed.length) {
    if (final) await notify(workspaceId, { type: "job_failed", title: `Social post failed on ${failed.join(", ")}`, body: failed.map((f) => `${f}: ${results[f]?.error}`).join("\n").slice(0, 500), dedupeKey: `social:fail:${postId}` });
    const msg = `Publishing failed on ${failed.map((f) => `${f} (${results[f]?.error})`).join("; ")}`;
    throw final ? new SocialConfigError(msg) : new Error(msg);
  }
  return { published: okCount, results };
}

/** Mark a post failed/partial when its job gives up. */
export async function markPublishGivenUp(workspaceId: string, postId: string) {
  const p = await getPost(workspaceId, postId).catch(() => null);
  if (!p || p.status === "published") return;
  const ok = p.platforms.filter((x) => p.results[x]?.ok).length;
  await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ status: ok ? "partial" : "failed", updatedAt: new Date() }).where(eq(schema.socialPosts.id, postId)));
}

export async function listPosts(workspaceId: string, status: string | undefined, limit = 50) {
  const S = schema.socialPosts;
  const groups: Record<string, string[]> = { review: ["draft"], scheduled: ["queued", "publishing"], published: ["published", "partial"], failed: ["failed"], rejected: ["rejected"] };
  return withTenant(workspaceId, (tx) =>
    tx
      .select()
      .from(S)
      .where(and(eq(S.workspaceId, workspaceId), status && groups[status] ? inArray(S.status, groups[status]) : undefined))
      .orderBy(desc(S.createdAt))
      .limit(limit),
  );
}

export async function postCounts(workspaceId: string) {
  const rows = await withTenant(workspaceId, (tx) => tx.select({ status: schema.socialPosts.status, n: sql<number>`count(*)::int` }).from(schema.socialPosts).where(eq(schema.socialPosts.workspaceId, workspaceId)).groupBy(schema.socialPosts.status));
  const c = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  return { review: c.draft ?? 0, scheduled: (c.queued ?? 0) + (c.publishing ?? 0), published: (c.published ?? 0) + (c.partial ?? 0), failed: c.failed ?? 0, rejected: c.rejected ?? 0 };
}

export async function testConnection(workspaceId: string, def: SocialConnectionDef) {
  const conn = await getConnection(workspaceId, def);
  let outcome: { ok: boolean; message: string };
  if (!conn.configured && def.secretFields.length + def.settingFields.filter((f) => f.required).length > 0) outcome = { ok: false, message: "Fill in the required fields and save first" };
  else {
    try {
      outcome = def.kind === "ai" ? await testAi(httpClient(), def.id, conn) : await testPlatform(deps(), def.id, conn);
    } catch (e) {
      outcome = { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
  await recordConnectionStatus(workspaceId, def, outcome, { test: true });
  return outcome;
}
