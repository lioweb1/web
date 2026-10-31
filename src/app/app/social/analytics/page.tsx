import { requireAuth } from "@/lib/auth/session";
import { commentCounts, socialAnalytics } from "@/lib/social/engage";
import { getAutopilot } from "@/lib/social/service";
import { fmtSlot, platformName } from "@/lib/social/format";
import { Card, CardBody, CardHeader, KpiCard, PageHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/states";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { BarList, TrendLine } from "@/components/charts/charts";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SocialNav } from "../nav";

export const metadata = { title: "Social analytics" };

export default async function SocialAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.range)) ? Number(sp.range) : 30;
  const { config, metricsSyncedAt } = await getAutopilot(ws);
  const [a, cc] = await Promise.all([socialAnalytics(ws, days, config.timezone), commentCounts(ws)]);
  const t = a.totals;
  const v = a.variants;
  return (
    <>
      <PageHeader
        title="Social analytics"
        description={`Engagement on your published posts, read from each platform's API${metricsSyncedAt ? ` (updated ${fmtSlot(metricsSyncedAt, config.timezone)})` : ""}. Engagement = likes + 2×comments + 3×shares. Telegram, Discord and LinkedIn don't expose metrics to these APIs.`}
        actions={
          <div className="flex gap-1">
            {[7, 30, 90].map((d) => (
              <Button key={d} asChild size="sm" variant={d === days ? "primary" : "secondary"}>
                <Link href={`/app/social/analytics?range=${d}`}>{d} days</Link>
              </Button>
            ))}
          </div>
        }
      />
      <SocialNav active="analytics" counts={{ comments: cc.inbox }} />
      {t.posts === 0 ? <Notice className="mb-4">No published posts in this period yet. Metrics appear a few hours after posts go out.</Notice> : null}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Posts published" value={t.posts} />
        <KpiCard label="Total engagement" value={t.engagement} hint={`${t.likes} likes · ${t.comments} comments · ${t.shares} shares`} />
        <KpiCard label="Avg engagement / post" value={t.avgPerPost} hint={t.views ? `${t.views} views (Threads)` : undefined} />
        <KpiCard label="Comments answered" value={`${t.repliesSent} / ${t.commentsReceived}`} href="/app/social/comments" />
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Engagement per day" />
          <CardBody>
            <TrendLine data={a.series} valueLabel="Engagement" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Best platforms" description="Average engagement per post" />
          <CardBody>
            <BarList data={a.platforms} valueLabel="Avg engagement" emptyText="No metrics yet." />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Best posting hours" description={`Average engagement by publish hour (${config.timezone}). Use the top hours as posting times.`} />
          <CardBody>
            <BarList data={a.hours.slice(0, 8)} valueLabel="Avg engagement" emptyText="No metrics yet." />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Hook A/B test" description="Chosen hook vs. rotated alternatives on other platforms" />
          <CardBody className="text-sm">
            {v.samples < 4 ? (
              <p className="text-muted">Not enough data yet ({v.samples} measured placements). Keep “A/B test hooks” on in settings.</p>
            ) : (
              <div className="space-y-2">
                <p>
                  Chosen hook: <span className="font-semibold tabular">{v.primary ?? "—"}</span> avg engagement
                </p>
                <p>
                  Alternative hooks: <span className="font-semibold tabular">{v.alternative ?? "—"}</span> avg engagement
                </p>
                <p className="text-xs text-muted">The AI receives your best-performing hooks as examples for new posts, so it learns what your audience clicks.</p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Top posts" />
        <Table>
          <THead>
            <tr>
              <TH>Hook</TH>
              <TH>Platforms</TH>
              <TH>Published</TH>
              <TH className="text-right">Engagement</TH>
            </tr>
          </THead>
          <tbody>
            {a.top.length === 0 ? (
              <TR>
                <TD colSpan={4} className="text-muted">
                  Nothing yet.
                </TD>
              </TR>
            ) : (
              a.top.map((p) => (
                <TR key={p.id}>
                  <TD className="max-w-md">{p.hook}</TD>
                  <TD className="text-xs text-muted">{p.platforms.map(platformName).join(", ")}</TD>
                  <TD className="whitespace-nowrap text-xs">{fmtSlot(p.publishedAt, config.timezone)}</TD>
                  <TD className="text-right tabular">{p.engagement}</TD>
                </TR>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
