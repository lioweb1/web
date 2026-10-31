import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import type { SocialPublishResult } from "@/lib/db/schema";
import { httpClient } from "@/lib/services/integrations";
import { notify } from "@/lib/notifications/notify";
import { getConnection, getConnectionDef, recordConnectionStatus, SOCIAL_PLATFORMS } from "./accounts";
import { generateReply } from "./ai";
import { COMMENT_FETCHERS, ENGAGE_PLATFORMS, METRICS_FETCHERS, REPLIERS, composeText, engagementOf } from "./publish";
import { deps, getAutopilot, postContent, requireAi, SocialConfigError, type Post } from "./service";
import { sendCommentForApproval } from "./telegram-notify";
import { zonedParts } from "./schedule";

export type Comment = typeof schema.socialComments.$inferSelect;

const METRICS_EVERY_MS = 3 * 3600_000;

async function recentPublished(workspaceId: string, days: number) {
  const S = schema.socialPosts;
  return withTenant(workspaceId, (tx) =>
    tx
      .select()
      .from(S)
      .where(and(eq(S.workspaceId, workspaceId), inArray(S.status, ["published", "partial"]), gte(S.publishedAt, new Date(Date.now() - days * 86400_000))))
      .orderBy(desc(S.publishedAt))
      .limit(60),
  );
}

export async function repliesInLast24h(workspaceId: string) {
  const C = schema.socialComments;
  const [{ n }] = await withTenant(workspaceId, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(C).where(and(eq(C.workspaceId, workspaceId), eq(C.status, "replied"), gte(C.repliedAt, new Date(Date.now() - 86400_000)))));
  return n;
}

async function draftReply(workspaceId: string, post: Post, c: Comment) {
  const { config } = await getAutopilot(workspaceId);
  const { def, conn } = await requireAi(workspaceId, config.aiProvider);
  const r = await generateReply(httpClient(), def.id, conn, config, { postHook: post.hook, postText: composeText("facebook", postContent(post, config)), comment: c.text, author: c.authorName });
  return r;
}

/**
 * Pull new top-level comments from every platform where a recent post was published, draft AI
 * replies, and (in auto mode, within the daily limit) send them. Also refreshes metrics every 3h.
 */
export async function syncEngagement(workspaceId: string, now = new Date()) {
  const ap = await getAutopilot(workspaceId);
  const cfg = ap.config;
  const stats = { checked: 0, newComments: 0, drafted: 0, replied: 0, skipped: 0, metricsUpdated: 0, errors: 0 };
  const errors: string[] = [];
  const posts = await recentPublished(workspaceId, 14);
  const conns = new Map<string, Awaited<ReturnType<typeof getConnection>>>();
  const connFor = async (platform: string) => {
    if (!conns.has(platform)) conns.set(platform, await getConnection(workspaceId, getConnectionDef("platform", platform)!));
    return conns.get(platform)!;
  };
  let replyBudget = cfg.autoReply === "auto" ? Math.max(0, cfg.maxRepliesPerDay - (await repliesInLast24h(workspaceId))) : 0;

  for (const post of posts) {
    for (const platform of post.platforms.filter((p) => ENGAGE_PLATFORMS.includes(p))) {
      const res = post.results[platform];
      if (!res?.ok || !res.id) continue;
      const conn = await connFor(platform);
      if (!conn.configured || !conn.enabled) continue;
      stats.checked++;
      let remote;
      try {
        remote = await COMMENT_FETCHERS[platform](deps(), conn, res);
      } catch (e) {
        stats.errors++;
        errors.push(`${platform}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (!remote.length) continue;
      const inserted = await withTenant(workspaceId, (tx) =>
        tx
          .insert(schema.socialComments)
          .values(remote.map((r) => ({ workspaceId, postId: post.id, platform, externalId: r.externalId, externalCid: r.cid ?? null, authorHandle: r.authorHandle, authorName: r.authorName, text: r.text.slice(0, 4000), url: r.url, commentedAt: r.commentedAt })))
          .onConflictDoNothing()
          .returning(),
      );
      stats.newComments += inserted.length;
      if (cfg.autoReply === "off") continue;
      for (const c of inserted) {
        try {
          const r = await draftReply(workspaceId, post, c);
          if (r.skip) {
            stats.skipped++;
            continue; // stays "new" for a human
          }
          await withTenant(workspaceId, (tx) => tx.update(schema.socialComments).set({ replyText: r.reply, status: "drafted", updatedAt: new Date() }).where(eq(schema.socialComments.id, c.id)));
          stats.drafted++;
          if (cfg.autoReply === "auto" && replyBudget > 0) {
            await sendReply(workspaceId, c.id);
            stats.replied++;
            replyBudget--;
          } else await sendCommentForApproval(workspaceId, { ...c, replyText: r.reply }, post.hook);
        } catch (e) {
          stats.errors++;
          errors.push(`reply: ${e instanceof Error ? e.message : String(e)}`);
          if (e instanceof SocialConfigError) break;
        }
      }
    }
  }
  if (stats.drafted && cfg.autoReply === "approve")
    await notify(workspaceId, { type: "announcement", title: `${stats.drafted} comment repl${stats.drafted > 1 ? "ies" : "y"} ready to send`, body: "Open Social autopilot → Comments to approve them.", dedupeKey: `social:replies:${now.toISOString().slice(0, 15)}` });

  if (!ap.metricsSyncedAt || now.getTime() - ap.metricsSyncedAt.getTime() >= METRICS_EVERY_MS) stats.metricsUpdated = await syncMetrics(workspaceId, connFor, errors);
  await withTenant(workspaceId, (tx) =>
    tx
      .update(schema.socialAutopilots)
      .set({ engageSyncedAt: now, ...(stats.metricsUpdated || !ap.metricsSyncedAt || now.getTime() - ap.metricsSyncedAt.getTime() >= METRICS_EVERY_MS ? { metricsSyncedAt: now } : {}) })
      .where(eq(schema.socialAutopilots.workspaceId, workspaceId)),
  );
  return { ...stats, errorMessages: errors.slice(0, 10) };
}

async function syncMetrics(workspaceId: string, connFor: (p: string) => Promise<Awaited<ReturnType<typeof getConnection>>>, errors: string[]) {
  let updated = 0;
  for (const post of await recentPublished(workspaceId, 30)) {
    const results: Record<string, SocialPublishResult> = { ...post.results };
    let changed = false;
    for (const [platform, res] of Object.entries(results)) {
      if (!res.ok || !res.id || !METRICS_FETCHERS[platform]) continue;
      const conn = await connFor(platform);
      if (!conn.configured) continue;
      try {
        results[platform] = { ...res, metrics: await METRICS_FETCHERS[platform](deps(), conn, res) };
        changed = true;
      } catch (e) {
        errors.push(`metrics ${platform}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (changed) {
      await withTenant(workspaceId, (tx) => tx.update(schema.socialPosts).set({ results, metricsUpdatedAt: new Date() }).where(eq(schema.socialPosts.id, post.id)));
      updated++;
    }
  }
  return updated;
}

export async function getComment(workspaceId: string, commentId: string) {
  const [row] = await withTenant(workspaceId, (tx) =>
    tx
      .select({ c: schema.socialComments, p: schema.socialPosts })
      .from(schema.socialComments)
      .innerJoin(schema.socialPosts, eq(schema.socialPosts.id, schema.socialComments.postId))
      .where(and(eq(schema.socialComments.id, commentId), eq(schema.socialComments.workspaceId, workspaceId))),
  );
  if (!row) throw new SocialConfigError("Comment not found");
  return row;
}

/** Send the drafted (or given) reply to the platform. */
export async function sendReply(workspaceId: string, commentId: string, text?: string) {
  const { c, p } = await getComment(workspaceId, commentId);
  if (c.status === "replied") throw new SocialConfigError("Already replied");
  const reply = (text ?? c.replyText ?? "").trim();
  if (!reply) throw new SocialConfigError("Write a reply first");
  const def = getConnectionDef("platform", c.platform);
  const res = p.results[c.platform];
  if (!def || !REPLIERS[c.platform] || !res?.ok) throw new SocialConfigError("Replies are not supported for this platform");
  const conn = await getConnection(workspaceId, def);
  if (!conn.configured) throw new SocialConfigError(`${def.name} is not connected`);
  try {
    const out = await REPLIERS[c.platform](deps(), conn, res, { externalId: c.externalId, cid: c.externalCid, authorHandle: c.authorHandle }, reply);
    await withTenant(workspaceId, (tx) => tx.update(schema.socialComments).set({ replyText: reply, status: "replied", replyId: out.id, repliedAt: new Date(), error: null, updatedAt: new Date() }).where(eq(schema.socialComments.id, commentId)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await withTenant(workspaceId, (tx) => tx.update(schema.socialComments).set({ replyText: reply, status: "failed", error: msg.slice(0, 500), updatedAt: new Date() }).where(eq(schema.socialComments.id, commentId)));
    await recordConnectionStatus(workspaceId, def, { ok: false, message: msg });
    throw e;
  }
}

export async function regenerateReply(workspaceId: string, commentId: string) {
  const { c, p } = await getComment(workspaceId, commentId);
  if (c.status === "replied") throw new SocialConfigError("Already replied");
  const r = await draftReply(workspaceId, p, c);
  const reply = r.reply || c.replyText || "";
  await withTenant(workspaceId, (tx) => tx.update(schema.socialComments).set({ replyText: reply, status: reply ? "drafted" : c.status, updatedAt: new Date() }).where(eq(schema.socialComments.id, commentId)));
  return { ...c, replyText: reply };
}

export async function updateComment(workspaceId: string, commentId: string, patch: { replyText?: string; status?: "ignored" | "drafted" | "new" }) {
  const { c } = await getComment(workspaceId, commentId);
  if (c.status === "replied") throw new SocialConfigError("Already replied");
  await withTenant(workspaceId, (tx) => tx.update(schema.socialComments).set({ ...patch, updatedAt: new Date() }).where(eq(schema.socialComments.id, commentId)));
}

export async function listComments(workspaceId: string, tab: string) {
  const C = schema.socialComments;
  const groups: Record<string, string[]> = { inbox: ["new", "drafted", "failed"], replied: ["replied"], ignored: ["ignored"] };
  return withTenant(workspaceId, (tx) =>
    tx
      .select({ c: C, hook: schema.socialPosts.hook })
      .from(C)
      .innerJoin(schema.socialPosts, eq(schema.socialPosts.id, C.postId))
      .where(and(eq(C.workspaceId, workspaceId), inArray(C.status, groups[tab] ?? groups.inbox)))
      .orderBy(desc(sql`coalesce(${C.commentedAt}, ${C.createdAt})`))
      .limit(100),
  );
}

export async function commentCounts(workspaceId: string) {
  const C = schema.socialComments;
  const rows = await withTenant(workspaceId, (tx) => tx.select({ status: C.status, n: sql<number>`count(*)::int` }).from(C).where(eq(C.workspaceId, workspaceId)).groupBy(C.status));
  const c = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  return { inbox: (c.new ?? 0) + (c.drafted ?? 0) + (c.failed ?? 0), replied: c.replied ?? 0, ignored: c.ignored ?? 0 };
}

/* ------------------------------------------------------------------ */
/* Analytics                                                            */
/* ------------------------------------------------------------------ */

export async function socialAnalytics(workspaceId: string, days: number, tz: string) {
  const since = new Date(Date.now() - days * 86400_000);
  const S = schema.socialPosts;
  const posts = await withTenant(workspaceId, (tx) =>
    tx
      .select()
      .from(S)
      .where(and(eq(S.workspaceId, workspaceId), inArray(S.status, ["published", "partial"]), isNotNull(S.publishedAt), gte(S.publishedAt, since)))
      .orderBy(desc(S.publishedAt))
      .limit(1000),
  );
  const totals = { posts: posts.length, likes: 0, comments: 0, shares: 0, views: 0, engagement: 0 };
  const byPlatform = new Map<string, { posts: number; engagement: number }>();
  const byDay = new Map<string, number>();
  const byHour = new Map<number, { posts: number; engagement: number }>();
  const variants = { primary: { n: 0, engagement: 0 }, alternative: { n: 0, engagement: 0 } };
  const top: { id: string; hook: string; engagement: number; platforms: string[]; publishedAt: Date }[] = [];

  for (const p of posts) {
    let postEng = 0;
    for (const [platform, r] of Object.entries(p.results)) {
      if (!r.ok) continue;
      const e = engagementOf(r.metrics);
      postEng += e;
      totals.likes += r.metrics?.likes ?? 0;
      totals.comments += r.metrics?.comments ?? 0;
      totals.shares += r.metrics?.shares ?? 0;
      totals.views += r.metrics?.views ?? 0;
      const b = byPlatform.get(platform) ?? { posts: 0, engagement: 0 };
      b.posts++;
      b.engagement += e;
      byPlatform.set(platform, b);
      if (r.metrics && p.hookVariants.length > 1 && r.hookIndex !== undefined) {
        const v = p.hookVariants[r.hookIndex] === p.hook ? variants.primary : variants.alternative;
        v.n++;
        v.engagement += e;
      }
    }
    totals.engagement += postEng;
    const lp = zonedParts(p.publishedAt!, tz);
    const day = `${lp.year}-${String(lp.month).padStart(2, "0")}-${String(lp.day).padStart(2, "0")}`;
    byDay.set(day, (byDay.get(day) ?? 0) + postEng);
    const h = byHour.get(lp.hour) ?? { posts: 0, engagement: 0 };
    h.posts++;
    h.engagement += postEng;
    byHour.set(lp.hour, h);
    top.push({ id: p.id, hook: p.hook, engagement: postEng, platforms: p.platforms, publishedAt: p.publishedAt! });
  }

  const C = schema.socialComments;
  const [{ replied, received }] = await withTenant(workspaceId, (tx) =>
    tx
      .select({ replied: sql<number>`count(*) filter (where ${C.status} = 'replied')::int`, received: sql<number>`count(*)::int` })
      .from(C)
      .where(and(eq(C.workspaceId, workspaceId), gte(C.createdAt, since))),
  );

  const series: { date: string; value: number }[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const lp = zonedParts(new Date(Date.now() - d * 86400_000), tz);
    const key = `${lp.year}-${String(lp.month).padStart(2, "0")}-${String(lp.day).padStart(2, "0")}`;
    series.push({ date: key, value: byDay.get(key) ?? 0 });
  }
  const name = (id: string) => SOCIAL_PLATFORMS.find((p) => p.id === id)?.name ?? id;
  return {
    totals: { ...totals, avgPerPost: posts.length ? Math.round(totals.engagement / posts.length) : 0, commentsReceived: received, repliesSent: replied },
    series,
    platforms: [...byPlatform.entries()].map(([k, v]) => ({ key: k, label: name(k), value: v.posts ? Math.round(v.engagement / v.posts) : 0, posts: v.posts })).sort((a, b) => b.value - a.value),
    hours: [...byHour.entries()].map(([h, v]) => ({ key: String(h), label: `${String(h).padStart(2, "0")}:00`, value: Math.round(v.engagement / v.posts), posts: v.posts })).sort((a, b) => b.value - a.value),
    variants: { primary: variants.primary.n ? Math.round(variants.primary.engagement / variants.primary.n) : null, alternative: variants.alternative.n ? Math.round(variants.alternative.engagement / variants.alternative.n) : null, samples: variants.primary.n + variants.alternative.n },
    top: top.sort((a, b) => b.engagement - a.engagement).slice(0, 10),
  };
}
