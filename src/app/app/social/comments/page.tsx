import { ExternalLink } from "lucide-react";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { commentCounts, listComments } from "@/lib/social/engage";
import { getAutopilot } from "@/lib/social/service";
import { platformName } from "@/lib/social/format";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Tabs, fmtDate, fmtRelative } from "@/components/ui/misc";
import { SocialNav } from "../nav";
import { ReplyForm } from "../forms";
import { ignoreCommentAction, regenerateReplyAction, syncEngagementNowAction } from "../actions";

export const metadata = { title: "Social comments" };

export default async function SocialCommentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const sp = await searchParams;
  const tab = ["inbox", "replied", "ignored"].includes(sp.tab ?? "") ? sp.tab! : "inbox";
  const [rows, counts, ap] = await Promise.all([listComments(ws, tab), commentCounts(ws), getAutopilot(ws)]);
  const canEdit = hasRole(ctx, "member");
  return (
    <>
      <PageHeader
        title="Comments"
        description={`New comments on your published posts (Facebook, Instagram, Threads, Bluesky, Mastodon) with AI-suggested replies. Checked every 30 minutes while the autopilot is on${ap.engageSyncedAt ? `, last ${fmtRelative(ap.engageSyncedAt)}` : ""}.`}
        actions={
          canEdit ? (
            <form action={syncEngagementNowAction}>
              <Button type="submit">Check now</Button>
            </form>
          ) : null
        }
      />
      <SocialNav active="comments" counts={{ comments: counts.inbox }} />
      <Tabs
        active={tab}
        tabs={[
          { id: "inbox", label: "Needs reply", href: "/app/social/comments?tab=inbox", count: counts.inbox },
          { id: "replied", label: "Replied", href: "/app/social/comments?tab=replied", count: counts.replied },
          { id: "ignored", label: "Ignored", href: "/app/social/comments?tab=ignored", count: counts.ignored },
        ]}
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No comments here" description="When people comment on your published posts, they appear here with a suggested reply." />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map(({ c, hook }) => (
            <Card key={c.id} className="grid gap-4 p-4 md:grid-cols-2">
              <div className="space-y-1.5 text-sm">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone="outline">{platformName(c.platform)}</Badge>
                  <span className="font-medium text-fg">{c.authorName ?? c.authorHandle ?? "Someone"}</span>
                  {c.commentedAt ? <span title={fmtDate(c.commentedAt, true)}>{fmtRelative(c.commentedAt)}</span> : null}
                  {c.status === "failed" ? <Badge tone="danger">Send failed</Badge> : c.status === "drafted" ? <Badge tone="info">Reply drafted</Badge> : c.status === "new" ? <Badge tone="warning">Needs a human</Badge> : null}
                </p>
                <p className="whitespace-pre-wrap">{c.text}</p>
                <p className="text-xs text-muted">
                  On: “{hook}”
                  {c.url ? (
                    <>
                      {" · "}
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                        open <ExternalLink className="size-3" />
                      </a>
                    </>
                  ) : null}
                </p>
                {c.error ? <p className="text-xs text-danger">{c.error}</p> : null}
              </div>
              <div className="space-y-2">
                {c.status === "replied" ? (
                  <p className="whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-sm">
                    <span className="text-xs text-muted">You replied {c.repliedAt ? fmtRelative(c.repliedAt) : ""}:</span>
                    <br />
                    {c.replyText}
                  </p>
                ) : canEdit ? (
                  <>
                    <ReplyForm commentId={c.id} replyText={c.replyText ?? ""} disabled={c.status === "ignored"} />
                    <div className="flex gap-1">
                      {c.status !== "ignored" ? (
                        <form action={regenerateReplyAction}>
                          <input type="hidden" name="commentId" value={c.id} />
                          <Button size="sm" variant="ghost" type="submit">
                            Suggest another
                          </Button>
                        </form>
                      ) : null}
                      <form action={ignoreCommentAction}>
                        <input type="hidden" name="commentId" value={c.id} />
                        {c.status === "ignored" ? <input type="hidden" name="restore" value="1" /> : null}
                        <Button size="sm" variant="ghost" type="submit">
                          {c.status === "ignored" ? "Restore" : "Ignore"}
                        </Button>
                      </form>
                    </div>
                  </>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
