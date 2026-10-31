import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { SOCIAL_PLATFORMS, listConnections } from "@/lib/social/accounts";
import { getAutopilot, listPosts, postContent, postCounts } from "@/lib/social/service";
import { commentCounts } from "@/lib/social/engage";
import { composeText, engagementOf } from "@/lib/social/publish";
import { hookScore } from "@/lib/social/ai";
import { cardImageUrl } from "@/lib/social/image";
import { fmtSlot, platformName } from "@/lib/social/format";
import { TREND_SOURCES } from "@/lib/social/trends";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/states";
import { Tabs, fmtDate, fmtRelative } from "@/components/ui/misc";
import { AutoRefresh } from "@/components/discovery/auto-refresh";
import { CopyButton, EditPostDialog, GenerateForm } from "./forms";
import { SocialNav } from "./nav";
import { chooseHookAction, deletePostAction, regeneratePostAction, rejectPostAction, runScanNowAction, schedulePostAction, unschedulePostAction } from "./actions";

export const metadata = { title: "Social autopilot" };

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "outline" }> = {
  draft: { label: "Needs review", tone: "info" },
  queued: { label: "Scheduled", tone: "accent" },
  publishing: { label: "Publishing", tone: "accent" },
  published: { label: "Published", tone: "success" },
  partial: { label: "Partly published", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  rejected: { label: "Rejected", tone: "neutral" },
};

const sourceName = (id: string) => (id === "manual" ? "Your text" : (TREND_SOURCES.find((s) => s.id === id)?.name ?? id));
const scoreTone = (s: number) => (s >= 70 ? "success" : s >= 50 ? "warning" : "neutral");

export default async function SocialPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const sp = await searchParams;
  const tab = ["review", "scheduled", "published", "failed", "rejected"].includes(sp.tab ?? "") ? sp.tab! : "review";
  const [ap, posts, counts, conns, cc] = await Promise.all([getAutopilot(ws), listPosts(ws, tab), postCounts(ws), listConnections(ws), commentCounts(ws)]);
  const canEdit = hasRole(ctx, "member");
  const cfg = ap.config;
  const ai = conns.find((c) => c.kind === "ai" && c.id === cfg.aiProvider);
  const connected = SOCIAL_PLATFORMS.filter((p) => conns.find((c) => c.kind === "platform" && c.id === p.id)?.configured);
  const platformOptions = SOCIAL_PLATFORMS.map((p) => ({ id: p.id, name: p.name }));
  const publishing = posts.some((p) => p.status === "publishing") || (tab === "scheduled" && counts.scheduled > 0);

  return (
    <>
      <PageHeader
        title="Social autopilot"
        description="Finds trending posts in your niche, has AI write original scroll-stopping, SEO-friendly posts for your brand, publishes them on a schedule through official APIs, and answers comments."
        actions={
          canEdit ? (
            <form action={runScanNowAction}>
              <Button type="submit" variant="primary">
                Scan for trends now
              </Button>
            </form>
          ) : null
        }
      />
      <SocialNav active="posts" counts={{ comments: cc.inbox }} />
      <AutoRefresh active={publishing} intervalMs={4000} />

      {!ai?.configured || !connected.length || !cfg.keywords.length ? (
        <Notice tone="warning" className="mb-4">
          Setup needed: {[!ai?.configured ? "add a free AI key (Gemini)" : null, !cfg.keywords.length ? "add niche keywords" : null, !connected.length ? "connect at least one account" : null].filter(Boolean).join(", ")}.{" "}
          <Link href="/app/social/settings" className="font-medium underline">
            Open settings
          </Link>
        </Notice>
      ) : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Autopilot" />
          <CardBody className="space-y-1.5 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={ap.active ? "success" : "neutral"}>{ap.active ? "On" : "Off"}</Badge>
              <Badge tone={cfg.mode === "auto" ? "warning" : "info"}>{cfg.mode === "auto" ? "Fully automatic" : "Approval required"}</Badge>
              {cfg.autoReply !== "off" ? <Badge tone="outline">Replies: {cfg.autoReply === "auto" ? "auto" : "approve"}</Badge> : null}
            </p>
            <p className="text-xs">
              <span className="text-muted">Keywords:</span> {cfg.keywords.length ? cfg.keywords.join(", ") : "none"}
            </p>
            <p className="text-xs">
              <span className="text-muted">Posting to:</span> {cfg.platforms.length ? cfg.platforms.map(platformName).join(", ") : "nothing selected"}
            </p>
            <p className="text-xs">
              <span className="text-muted">Posting times:</span> {cfg.scheduleMode === "slots" ? `${cfg.postingTimes.join(", ")} (${cfg.timezone})` : "immediately"}
            </p>
            <p className="text-xs">
              <span className="text-muted">Last scan:</span> {ap.lastRunAt ? `${fmtDate(ap.lastRunAt, true)} (${fmtRelative(ap.lastRunAt)})` : "never"}
              {ap.lastRunStats ? ` · ${ap.lastRunStats.fetched ?? 0} trends · ${ap.lastRunStats.drafted ?? 0} drafted · ${ap.lastRunStats.queued ?? 0} scheduled` : ""}
            </p>
            <p className="text-xs">
              <span className="text-muted">Next scan:</span> {ap.active && ap.nextRunAt ? fmtRelative(ap.nextRunAt) : "—"}
            </p>
            {ap.lastError ? <p className="text-xs text-danger">{ap.lastError}</p> : null}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Write a post from any text" description="Paste a trending post, keywords or an idea. The AI writes 3 hooks, platform-specific versions, a thread, hashtags and an engagement comment." />
          <CardBody>{canEdit ? <GenerateForm platforms={platformOptions} defaultPlatforms={cfg.platforms} /> : <p className="text-sm text-muted">Viewers cannot create posts.</p>}</CardBody>
        </Card>
      </div>

      <Tabs
        active={tab}
        tabs={[
          { id: "review", label: "To review", href: "/app/social?tab=review", count: counts.review },
          { id: "scheduled", label: "Scheduled", href: "/app/social?tab=scheduled", count: counts.scheduled },
          { id: "published", label: "Published", href: "/app/social?tab=published", count: counts.published },
          { id: "failed", label: "Failed", href: "/app/social?tab=failed", count: counts.failed },
          { id: "rejected", label: "Rejected", href: "/app/social?tab=rejected", count: counts.rejected },
        ]}
      />

      {posts.length === 0 ? (
        <Card>
          <EmptyState title="Nothing here yet" description={tab === "review" ? "Run a scan or paste some text above to create your first draft." : "Posts will appear here as they move through publishing."} />
        </Card>
      ) : (
        <div className="space-y-4">
          {posts.map((p) => {
            const s = STATUS[p.status] ?? STATUS.draft;
            const editable = !["queued", "publishing", "published"].includes(p.status);
            const content = { ...postContent(p, cfg), imageUrl: null };
            const preview = composeText("facebook", content);
            const shortPreview = composeText("bluesky", content);
            const kw = [p.primaryKeyword ?? "", ...cfg.keywords];
            const score = hookScore(p.hook, kw);
            const img = p.imageUrl ?? (cfg.autoImage && p.autoImage ? cardImageUrl(p.id, { version: p.updatedAt }) : null);
            const totalEng = Object.values(p.results).reduce((a, r) => a + engagementOf(r.metrics), 0);
            return (
              <Card key={p.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {p.hook}
                      <Badge tone={s.tone}>{s.label}</Badge>
                      <Badge tone={scoreTone(score)} title="Hook strength: length, numbers, power words, curiosity, keyword">
                        Hook {score}
                      </Badge>
                      {p.primaryKeyword ? <Badge tone="outline">SEO: {p.primaryKeyword}</Badge> : null}
                    </span>
                  }
                  description={
                    <span>
                      {sourceName(p.sourceId)} · {fmtRelative(p.createdAt)}
                      {p.scheduledAt && p.status === "queued" ? ` · goes out ${fmtSlot(p.scheduledAt, cfg.timezone)}` : ""}
                      {p.publishedAt ? ` · published ${fmtSlot(p.publishedAt, cfg.timezone)}` : ""}
                      {totalEng ? ` · ${totalEng} engagement` : ""}
                      {p.sourceUrl ? (
                        <>
                          {" · "}
                          <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                            inspiration <ExternalLink className="size-3" />
                          </a>
                        </>
                      ) : null}
                    </span>
                  }
                  action={
                    canEdit ? (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {editable && p.status !== "rejected" ? (
                          <>
                            <form action={schedulePostAction}>
                              <input type="hidden" name="postId" value={p.id} />
                              <input type="hidden" name="when" value={cfg.scheduleMode === "slots" ? "slot" : "now"} />
                              <Button size="sm" variant="primary" type="submit" disabled={!p.platforms.length}>
                                {p.status === "draft" ? (cfg.scheduleMode === "slots" ? "Approve & schedule" : "Approve & publish") : "Retry"}
                              </Button>
                            </form>
                            {cfg.scheduleMode === "slots" ? (
                              <form action={schedulePostAction}>
                                <input type="hidden" name="postId" value={p.id} />
                                <input type="hidden" name="when" value="now" />
                                <Button size="sm" type="submit" disabled={!p.platforms.length}>
                                  Publish now
                                </Button>
                              </form>
                            ) : null}
                          </>
                        ) : null}
                        {p.status === "queued" ? (
                          <form action={unschedulePostAction}>
                            <input type="hidden" name="postId" value={p.id} />
                            <Button size="sm" variant="ghost" type="submit">
                              Unschedule
                            </Button>
                          </form>
                        ) : null}
                        {editable ? <EditPostDialog post={p} platforms={platformOptions} /> : null}
                        {p.status === "draft" ? (
                          <form action={regeneratePostAction}>
                            <input type="hidden" name="postId" value={p.id} />
                            <Button size="sm" variant="ghost" type="submit">
                              Rewrite
                            </Button>
                          </form>
                        ) : null}
                        {p.status === "draft" || p.status === "rejected" ? (
                          <form action={rejectPostAction}>
                            <input type="hidden" name="postId" value={p.id} />
                            {p.status === "rejected" ? <input type="hidden" name="restore" value="1" /> : null}
                            <Button size="sm" variant="ghost" type="submit">
                              {p.status === "rejected" ? "Restore" : "Reject"}
                            </Button>
                          </form>
                        ) : null}
                        {editable || p.status === "queued" ? (
                          <ConfirmDialog
                            trigger={
                              <Button size="sm" variant="ghost" className="text-danger">
                                Delete
                              </Button>
                            }
                            title="Delete this post?"
                            description="Posts already published on a platform stay there."
                            confirmLabel="Delete"
                            action={deletePostAction}
                            hidden={{ postId: p.id }}
                          />
                        ) : null}
                      </div>
                    ) : null
                  }
                />
                <div className="grid gap-4 px-4 py-3 lg:grid-cols-[1fr_1fr_220px]">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-xs font-medium text-muted">Main post</p>
                      <CopyButton text={preview} />
                    </div>
                    <p className="whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-sm">{preview}</p>
                  </div>
                  <div className="space-y-3 text-sm">
                    {p.hookVariants.length > 1 ? (
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted">Hook variants {cfg.rotateHooks ? "(rotated across platforms)" : ""}</p>
                        <ul className="space-y-1">
                          {p.hookVariants.map((h) => (
                            <li key={h} className="flex items-start justify-between gap-2 rounded-md bg-surface-2 px-2 py-1.5 text-xs">
                              <span>
                                {h === p.hook ? "★ " : ""}
                                {h} <span className="text-muted">({hookScore(h, kw)})</span>
                              </span>
                              {editable && canEdit && h !== p.hook ? (
                                <form action={chooseHookAction}>
                                  <input type="hidden" name="postId" value={p.id} />
                                  <input type="hidden" name="hook" value={h} />
                                  <button type="submit" className="whitespace-nowrap text-accent hover:underline">
                                    Use
                                  </button>
                                </form>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-xs font-medium text-muted">Short version{cfg.threadMode && p.thread.length ? ` + ${p.thread.length}-part thread` : ""}</p>
                        <CopyButton text={shortPreview} />
                      </div>
                      <p className="whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-xs">{shortPreview}</p>
                    </div>
                    {p.engagementComment ? (
                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <p className="text-xs font-medium text-muted">Engagement comment</p>
                          <CopyButton text={p.engagementComment} />
                        </div>
                        <p className="whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-xs">{p.engagementComment}</p>
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-3">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={p.altText ?? p.hook} loading="lazy" className="aspect-square w-full rounded-md border border-border object-cover" />
                    ) : null}
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted">Platforms</p>
                      <ul className="space-y-1">
                        {p.platforms.length === 0 ? <li className="text-xs text-muted">None selected</li> : null}
                        {p.platforms.map((pl) => {
                          const r = p.results[pl];
                          return (
                            <li key={pl} className="flex flex-wrap items-center gap-1.5 text-xs">
                              <span>{platformName(pl)}</span>
                              {r?.ok ? (
                                r.url ? (
                                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-success hover:underline">
                                    posted <ExternalLink className="size-3" />
                                  </a>
                                ) : (
                                  <Badge tone="success">posted</Badge>
                                )
                              ) : r ? (
                                <span className="text-danger">{r.error}</span>
                              ) : null}
                              {r?.metrics ? (
                                <span className="text-muted">
                                  ♥ {r.metrics.likes} · 💬 {r.metrics.comments} · ↻ {r.metrics.shares}
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
