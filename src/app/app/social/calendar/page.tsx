import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { calendarPosts, getAutopilot } from "@/lib/social/service";
import { commentCounts } from "@/lib/social/engage";
import { parseTimes, toLocalInput, zonedParts, zonedTimeToUtc } from "@/lib/social/schedule";
import { fmtSlot, platformName } from "@/lib/social/format";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SocialNav } from "../nav";
import { RescheduleForm } from "../forms";
import { schedulePostAction, unschedulePostAction } from "../actions";

export const metadata = { title: "Social calendar" };

const DAYS = 14;

export default async function SocialCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const sp = await searchParams;
  const offset = Math.max(-8, Math.min(8, Number(sp.week) || 0));
  const { config } = await getAutopilot(ws);
  const tz = config.timezone;
  const today = zonedParts(new Date(Date.now() + offset * 7 * 86400_000), tz);
  const dayStart = (i: number) => zonedTimeToUtc(today.year, today.month, today.day + i, 0, 0, tz);
  const from = dayStart(0);
  const to = dayStart(DAYS);
  const [posts, cc] = await Promise.all([calendarPosts(ws, from, to), commentCounts(ws)]);
  const canEdit = hasRole(ctx, "member");
  const slots = parseTimes(config.postingTimes);
  const days = Array.from({ length: DAYS }, (_, i) => {
    const start = dayStart(i);
    const end = dayStart(i + 1);
    return { start, items: posts.filter((p) => {
      const at = p.publishedAt ?? p.scheduledAt!;
      return at >= start && at < end;
    }) };
  });
  const dayLabel = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
  const timeLabel = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

  return (
    <>
      <PageHeader
        title="Social calendar"
        description={`Scheduled and published posts for the next ${DAYS} days, in ${tz}. ${config.scheduleMode === "slots" && slots.length ? `Posting times: ${slots.join(", ")}.` : "Approved posts publish immediately."}`}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="secondary">
              <Link href={`/app/social/calendar?week=${offset - 1}`}>← Earlier</Link>
            </Button>
            {offset !== 0 ? (
              <Button asChild variant="secondary">
                <Link href="/app/social/calendar">Today</Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary">
              <Link href={`/app/social/calendar?week=${offset + 1}`}>Later →</Link>
            </Button>
          </div>
        }
      />
      <SocialNav active="calendar" counts={{ comments: cc.inbox }} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {days.map((d) => (
          <Card key={d.start.toISOString()} className="min-h-40 p-3">
            <p className="mb-2 text-xs font-semibold text-muted">{dayLabel(d.start)}</p>
            {d.items.length === 0 ? <p className="text-xs text-subtle">No posts</p> : null}
            <ul className="space-y-2">
              {d.items.map((p) => {
                const at = p.publishedAt ?? p.scheduledAt!;
                const firstUrl = Object.values(p.results).find((r) => r.ok && r.url)?.url;
                return (
                  <li key={p.id} className="space-y-1 rounded-md border border-border bg-surface-2 p-2 text-xs">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold tabular">{timeLabel(at)}</span>
                      <Badge tone={p.status === "published" ? "success" : p.status === "queued" ? "accent" : p.status === "failed" ? "danger" : "warning"}>{p.status === "queued" ? "scheduled" : p.status}</Badge>
                    </div>
                    <p className="line-clamp-3">{p.hook}</p>
                    <p className="text-muted">{p.platforms.map(platformName).join(" · ")}</p>
                    {firstUrl ? (
                      <a href={firstUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                        View <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                    {p.status === "queued" && canEdit ? (
                      <div className="space-y-1 pt-1">
                        <RescheduleForm postId={p.id} value={toLocalInput(at, tz)} />
                        <div className="flex gap-1">
                          <form action={schedulePostAction}>
                            <input type="hidden" name="postId" value={p.id} />
                            <input type="hidden" name="when" value="now" />
                            <Button size="sm" variant="ghost" type="submit" title={`Instead of ${fmtSlot(at, tz)}`}>
                              Now
                            </Button>
                          </form>
                          <form action={unschedulePostAction}>
                            <input type="hidden" name="postId" value={p.id} />
                            <Button size="sm" variant="ghost" type="submit">
                              Unschedule
                            </Button>
                          </form>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
