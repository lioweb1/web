import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { schema, systemDb, withTenant } from "@/lib/db";
import type { SocialAutopilotConfig, SocialPublishResult } from "@/lib/db/schema";
import { httpClient } from "@/lib/services/integrations";
import { defaultResolver, type Resolver } from "@/lib/analysis/net";
import { enqueue } from "@/lib/jobs/queue";
import { notify } from "@/lib/notifications/notify";
import { ProviderHttpError } from "@/lib/providers/http";
import { AI_PROVIDERS, SOCIAL_PLATFORMS, getConnection, getConnectionDef, recordConnectionStatus, type SocialConnectionDef } from "./accounts";
import { generatePost, testAi, type TrendInput } from "./ai";
import { PUBLISHERS, engagementOf, testPlatform, type PostContent } from "./publish";
import { fetchTrends, TREND_SOURCES } from "./trends";
import { cardImageUrl } from "./image";
import { isValidTimeZone, nextSlot, parseTimes } from "./schedule";
import { sendPostForApproval } from "./telegram-notify";

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
  scheduleMode: "slots",
  postingTimes: ["09:00", "13:00", "20:00"],
  timezone: "Asia/Dhaka",
  autoReply: "approve",
  maxRepliesPerDay: 30,
  rotateHooks: true,
  threadMode: true,
  autoImage: true,
  brandColor: "#4f46e5",
  utm: true,
};

export const MIN_INTERVAL_MINUTES = 30;

/** Errors caused by missing or invalid user configuration; safe to show and not worth retrying. */
export class SocialConfigError extends Error {}

let resolverOverride: Resolver | null = null;
export function setSocialResolverForTests(r: Resolver | null) {
  resolverOverride = r;
}
export const deps = () => ({ http: httpClient(), resolve: resolverOverride ?? defaultResolver });

export type Post = typeof schema.socialPosts.$inferSelect;
const LOCKED = ["queued", "publishing", "published"];

export async function getAutopilot(workspaceId: string) {
  const [row] = await withTenant(workspaceId, (tx) => tx.select().from(schema.socialAutopilots).where(eq(schema.socialAutopilots.workspaceId, workspaceId)));
  return {
    active: row?.active ?? false,
    intervalMinutes: row?.intervalMinutes ?? 180,
    config: { ...DEFAULT_CONFIG, ...row?.config },
    lastRunAt: row?.lastRunAt ?? null,
    lastError: row?.lastError ?? null,
    lastRunStats: row?.lastRunStats ?? null,
    nextRunAt: row?.nextRunAt ?? null,
    engageSyncedAt: row?.engageSyncedAt ?? null,
    metricsSyncedAt: row?.metricsSyncedAt ?? null,
  };
}

export function validateConfig(cfg: SocialAutopilotConfig, active: boolean) {
  const errors: string[] = [];
  if (!AI_PROVIDERS.some((p) => p.id === cfg.aiProvider)) errors.push("Choose an AI writer");
  if (cfg.sources.some((s) => !TREND_SOURCES.some((t) => t.id === s))) errors.push("Unknown trend source");
  if (cfg.platforms.some((p) => !SOCIAL_PLATFORMS.some((s) => s.id === p))) errors.push("Unknown platform");
  if (cfg.link && !/^https?:\/\/\S+$/.test(cfg.link)) errors.push("Link must start with http:// or https://");
  if (cfg.feeds.some((f) => !/^https?:\/\/\S+$/.test(f))) errors.push("Every RSS feed must be an http(s) URL");
  if (!isValidTimeZone(cfg.timezone)) errors.push("Unknown time zone (use a name like Asia/Dhaka)");
  if (cfg.scheduleMode === "slots" && !parseTimes(cfg.postingTimes).length) errors.push("Add at least one posting time like 09:00");
  if (cfg.brandColor && !/^#[0-9a-f]{6}$/i.test(cfg.brandColor)) errors.push("Brand colour must look like #4f46e5");
  if (active) {
    if (!cfg.keywords.length) errors.push("Add at least one niche keyword");
    if (!cfg.sources.length) errors.push("Choose at least one trend source");
    if (!cfg.platforms.length) errors.push("Choose at least one platform");
    if (cfg.sources.includes("rss") && !cfg.feeds.length) errors.push("Add at least one RSS feed or untick “Your RSS feeds”");
  }
  return errors;
}

export async function saveAutopilot(workspaceId: string, input: { active: boolean; intervalMinutes: number; config: SocialAutopilotConfig }) {
  const config = { ...input.config, postingTimes: parseTimes(input.config.postingTimes) };
  const errors = validateConfig(config, input.active);
  if (errors.length) throw new SocialConfigError(errors.join(". "));
  const intervalMinutes = Math.max(MIN_INTERVAL_MINUTES, input.intervalMinutes);
  await withTenant(workspaceId, async (tx) => {
    const [existing] = await tx.select().from(schema.socialAutopilots).where(eq(schema.socialAutopilots.workspaceId, workspaceId));
    // Start soon after activation; otherwise keep the schedule.
    const nextRunAt = input.active ? (existing?.active && existing.nextRunAt ? existing.nextRunAt : new Date(Date.now() + 60_000)) : null;
    const values = { active: input.active, intervalMinutes, config, nextRunAt, updatedAt: new Date() };
    if (existing) await tx.update(schema.socialAutopilots).set(values).where(eq(schema.socialAutopilots.workspaceId, workspaceId));
    else await tx.insert(schema.socialAutopilots).values({ workspaceId, ...values });
  });
}

export async function requireAi(workspaceId: string, providerId: string) {
  const def = getConnectionDef("ai", providerId);
  if (!def) throw new SocialConfigError("Choose an AI writer in Social autopilot settings");
  const conn = await getConnection(workspaceId, def);
  if (!conn.configured) throw new SocialConfigError(`${def.name} is not configured. Add its API key under Social autopilot → Settings.`);
  return { def, conn };
}

/** Hooks of the best-performing recent posts, fed back into the prompt so the AI learns the audience. */
export async function winningHooks(workspaceId: string, limit = 3) {
  const rows = await withTenant(workspaceId, (tx) =>
    tx
      .select({ hook: schema.socialPosts.hook, variants: schema.socialPosts.hookVariants, results: schema.socialPosts.results })
      .from(schema.socialPosts)
      .where(and(eq(schema.socialPosts.workspaceId, workspaceId), isNotNull(schema.socialPosts.metricsUpdatedAt), gte(schema.socialPosts.publishedAt, new Date(Date.now() - 60 * 86400_000))))
      .limit(300),
  );
  const scored = new Map<string, number>();
  for (const r of rows)
    for (const res of Object.values(r.results)) {
      if (!res.ok || !res.metrics) continue;
      const hook = r.variants[res.hookIndex ?? -1] ?? r.hook;
      scored.set(hook, (scored.get(hook) ?? 0) + engagementOf(res.metrics));
    }
  return [...scored.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([h]) => h);
}

async function writePost(workspaceId: string, cfg: SocialAutopilotConfig, trend: TrendInput) {
  const { def, conn } = await requireAi(workspaceId, cfg.aiProvider);
  try {
    const gen = await generatePost(httpClient(), def.id, conn, cfg, trend, { winningHooks: await winningHooks(workspaceId) });
    await recordConnectionStatus(workspaceId, def, { ok: true, message: "ok" });
    return {
      hook: gen.hooks[0],
      hookVariants: gen.hooks,
      body: gen.body,
      shortBody: gen.shortBody,
      platformTexts: gen.platformTexts as Record<string, string>,
      thread: gen.thread,
      engagementComment: gen.engagementComment,
      hashtags: gen.hashtags,
      primaryKeyword: gen.primaryKeyword || null,
      altText: gen.altText || null,
      aiProvider: def.id,
    };
  } catch (e) {
    await recordConnectionStatus(workspaceId, def, { ok: false, message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

async function insertDraft(workspaceId: string, cfg: SocialAutopilotConfig, trend: TrendInput & { sourceId: string; externalId: string | null }, opts: { imageUrl?: string | null; platforms?: string[] } = {}) {
  const written = await writePost(workspaceId, cfg, trend);
  const [row] = await withTenant(workspaceId, (tx) =>
    tx
      .insert(schema.socialPosts)
      .values({ workspaceId, sourceId: trend.sourceId, sourceExternalId: trend.externalId, sourceTitle: trend.title.slice(0, 500), sourceUrl: trend.url ?? null, ...written, imageUrl: opts.imageUrl ?? null, platforms: opts.platforms ?? cfg.platforms })
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

/** Rewrite a draft from the same source (new hooks and texts). */
export async function regeneratePost(workspaceId: string, postId: string) {
  const p = await getPost(workspaceId, postId);
  if (LOCKED.includes(p.status)) throw new SocialConfigError("This post is already published or being published");
  const { config } = await getAutopilot(workspaceId);
  const name = p.sourceId === "manual" ? "the user" : (TREND_SOURCES.find((s) => s.id === p.sourceId)?.name ?? p.sourceId);
  const written = await writePost(workspaceId, config, { title: p.sourceTitle ?? p.hook, url: p.sourceUrl, sourceName: name });
  const [row] = await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ ...written, status: "draft", updatedAt: new Date() }).where(eq(schema.socialPosts.id, postId)).returning());
  return row;
}

export async function publishedInLast24h(workspaceId: string, now = new Date()) {
  const S = schema.socialPosts;
  const [{ n }] = await withTenant(workspaceId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(S)
      .where(and(eq(S.workspaceId, workspaceId), inArray(S.status, ["queued", "publishing", "published", "partial"]), gte(sql`coalesce(${S.publishedAt}, ${S.scheduledAt}, ${S.updatedAt})`, new Date(now.getTime() - 86400_000)))),
  );
  return n;
}

/** One autopilot pass: find trends, draft posts, and in auto mode schedule them. */
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
          await queuePublish(workspaceId, post.id, { when: cfg.scheduleMode === "slots" ? "slot" : "now", now });
          stats.queued++;
          budget--;
        } else await sendPostForApproval(workspaceId, post, cfg.link);
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

export type PostPatch = {
  hook: string;
  hookVariants: string[];
  body: string;
  shortBody: string;
  platformTexts: Record<string, string>;
  thread: string[];
  engagementComment: string;
  hashtags: string[];
  primaryKeyword: string | null;
  altText: string | null;
  imageUrl: string | null;
  autoImage: boolean;
  platforms: string[];
};

export async function updatePost(workspaceId: string, postId: string, patch: Partial<PostPatch>) {
  const p = await getPost(workspaceId, postId);
  if (LOCKED.includes(p.status)) throw new SocialConfigError("This post is already published or being published");
  if (patch.platforms?.some((x) => !SOCIAL_PLATFORMS.some((s) => s.id === x))) throw new SocialConfigError("Unknown platform");
  const next = { ...patch };
  // Keep the chosen hook in the variant list so A/B rotation and analytics stay consistent.
  if (next.hook) {
    const variants = next.hookVariants ?? p.hookVariants;
    next.hookVariants = variants.includes(next.hook) ? variants : [next.hook, ...variants.slice(0, 4)];
  }
  await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ ...next, updatedAt: new Date() }).where(eq(schema.socialPosts.id, postId)));
}

async function cancelQueuedJobs(postId: string) {
  await systemDb()
    .update(schema.jobs)
    .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.jobs.type, "social_publish"), eq(schema.jobs.status, "queued"), sql`${schema.jobs.payload}->>'postId' = ${postId}`));
}

/** Times already taken by queued posts, so two posts never go out in the same slot. */
async function takenSlots(workspaceId: string, exceptPostId?: string) {
  const rows = await withTenant(workspaceId, (tx) =>
    tx
      .select({ id: schema.socialPosts.id, at: schema.socialPosts.scheduledAt })
      .from(schema.socialPosts)
      .where(and(eq(schema.socialPosts.workspaceId, workspaceId), inArray(schema.socialPosts.status, ["queued", "publishing"]), isNotNull(schema.socialPosts.scheduledAt))),
  );
  return rows.filter((r) => r.id !== exceptPostId).map((r) => r.at!);
}

/** Schedule a post: now, at the next free posting slot, or at an exact time. */
export async function queuePublish(workspaceId: string, postId: string, opts: { when?: "now" | "slot" | Date; now?: Date } = {}) {
  const p = await getPost(workspaceId, postId);
  if (!p.platforms.length) throw new SocialConfigError("Choose at least one platform for this post");
  if (p.status === "publishing" || p.status === "published") throw new SocialConfigError("This post is already published or being published");
  const now = opts.now ?? new Date();
  let at = now;
  if (opts.when instanceof Date) {
    if (opts.when.getTime() < now.getTime() - 60_000) throw new SocialConfigError("Pick a time in the future");
    at = opts.when;
  } else if (opts.when === "slot") {
    const { config } = await getAutopilot(workspaceId);
    at = nextSlot(config.postingTimes, config.timezone, now, await takenSlots(workspaceId, postId));
  }
  await cancelQueuedJobs(postId);
  await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ status: "queued", scheduledAt: at, updatedAt: new Date() }).where(eq(schema.socialPosts.id, postId)));
  await enqueue({ type: "social_publish", workspaceId, payload: { postId, at: at.toISOString() }, runAt: at, idempotencyKey: `social:${postId}:${at.getTime()}:${Date.now()}`, maxAttempts: 3 });
  return at;
}

/** Move a scheduled post back to drafts. */
export async function unschedulePost(workspaceId: string, postId: string) {
  const p = await getPost(workspaceId, postId);
  if (p.status !== "queued") throw new SocialConfigError("Only scheduled posts can be moved back to drafts");
  await cancelQueuedJobs(postId);
  await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ status: "draft", scheduledAt: null, updatedAt: new Date() }).where(eq(schema.socialPosts.id, postId)));
}

export async function setPostStatus(workspaceId: string, postId: string, status: "rejected" | "draft") {
  const p = await getPost(workspaceId, postId);
  if (LOCKED.includes(p.status)) throw new SocialConfigError("This post is already published or being published");
  await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ status, updatedAt: new Date() }).where(eq(schema.socialPosts.id, postId)));
}

export async function deletePost(workspaceId: string, postId: string) {
  await cancelQueuedJobs(postId);
  await withTenant(workspaceId, (tx) => tx.delete(schema.socialPosts).where(and(eq(schema.socialPosts.id, postId), eq(schema.socialPosts.workspaceId, workspaceId))));
}

/** Content for one post as publishers see it (image card, UTM, thread mode resolved). */
export function postContent(p: Post, cfg: SocialAutopilotConfig, hook = p.hook): PostContent {
  return {
    hook,
    body: p.body,
    shortBody: p.shortBody,
    platformTexts: p.platformTexts,
    thread: p.thread,
    hashtags: p.hashtags,
    imageUrl: p.imageUrl ?? (cfg.autoImage && p.autoImage ? cardImageUrl(p.id, { absolute: true, version: p.updatedAt }) : null),
    altText: p.altText,
    link: cfg.link,
    utm: cfg.utm,
    threadMode: cfg.threadMode,
  };
}

/**
 * Publish a post to every selected platform that has not succeeded yet. Retries only failed
 * platforms, so a partial failure never double-posts. Throws if any platform still failed.
 */
export async function publishPost(workspaceId: string, postId: string, opts: { finalAttempt?: boolean; now?: Date } = {}) {
  const p = await getPost(workspaceId, postId);
  if (p.status === "published") return { skipped: true };
  // Rescheduled, unscheduled or rejected since this job was queued.
  if (p.status !== "queued" && p.status !== "publishing") return { skipped: true, reason: `post is ${p.status}` };
  if (p.scheduledAt && p.scheduledAt.getTime() > (opts.now ?? new Date()).getTime() + 60_000) return { skipped: true, reason: "rescheduled" };
  const { config } = await getAutopilot(workspaceId);
  await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ status: "publishing", updatedAt: new Date() }).where(eq(schema.socialPosts.id, postId)));
  const variants = p.hookVariants.length ? p.hookVariants : [p.hook];
  const chosen = Math.max(0, variants.indexOf(p.hook));
  const results: Record<string, SocialPublishResult> = { ...p.results };
  let retryable = false;
  for (const [i, platform] of p.platforms.entries()) {
    if (results[platform]?.ok) continue;
    const def = getConnectionDef("platform", platform);
    const at = new Date().toISOString();
    const hookIndex = config.rotateHooks && variants.length > 1 ? (chosen + i) % variants.length : chosen;
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
      const out = await PUBLISHERS[platform](deps(), conn, postContent(p, config, variants[hookIndex]));
      results[platform] = { ok: true, id: out.id, cid: out.cid ?? null, url: out.url, at, hookIndex };
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
      .orderBy(status === "scheduled" ? S.scheduledAt : desc(S.createdAt))
      .limit(limit),
  );
}

/** Posts scheduled or published between two instants (calendar). */
export async function calendarPosts(workspaceId: string, from: Date, to: Date) {
  const S = schema.socialPosts;
  return withTenant(workspaceId, (tx) =>
    tx
      .select()
      .from(S)
      .where(and(eq(S.workspaceId, workspaceId), inArray(S.status, ["queued", "publishing", "published", "partial", "failed"]), gte(sql`coalesce(${S.publishedAt}, ${S.scheduledAt})`, from), sql`coalesce(${S.publishedAt}, ${S.scheduledAt}) < ${to}`))
      .orderBy(sql`coalesce(${S.publishedAt}, ${S.scheduledAt})`),
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
