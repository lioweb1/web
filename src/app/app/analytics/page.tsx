import { requireAuth } from "@/lib/auth/session";
import { PageHeader, Card, CardHeader, CardBody, KpiCard } from "@/components/ui/card";
import { RangeFilter } from "@/components/charts/range-filter";
import { BarList, TrendLine, StackedBars } from "@/components/charts/charts";
import { getAnalytics, getJobStats, parseRange } from "@/lib/queries/analytics";
import { getTargetMarkets } from "@/lib/queries/dashboard";
import { countryName } from "@/lib/countries";
import { fmtDate } from "@/components/ui/misc";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireAuth();
  const range = parseRange(await searchParams);
  const ws = ctx.workspace.id;
  const [a, jobs, markets] = await Promise.all([getAnalytics(ws, range), getJobStats(ws, range), getTargetMarkets(ws)]);
  const totalInRange = a.trend.reduce((s, d) => s + d.value, 0);

  return (
    <>
      <PageHeader title="Analytics" description={`Calculated from leads stored in this workspace, ${fmtDate(range.from)} – ${fmtDate(range.to)}. Breakdowns cover leads saved in the period; the pipeline covers all active leads.`} />
      <RangeFilter action="/app/analytics" preset={range.preset} from={range.from} to={range.to} countries={range.countries} markets={markets} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Leads saved in period" value={totalInRange.toLocaleString()} />
        <KpiCard label="Countries represented" value={a.byCountry.filter((c) => c.key !== "unknown").length.toLocaleString()} />
        <KpiCard label="Contacted (all time)" value={a.conversion.contacted.toLocaleString()} />
        <KpiCard label="Won / contacted" value={a.conversion.rate === null ? "—" : `${(a.conversion.rate * 100).toFixed(1)}%`} hint={a.conversion.rate === null ? "No contacted leads yet" : `${a.conversion.won} won`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="Lead discovery trend" description="Leads saved per day (UTC)" />
          <CardBody>
            <TrendLine data={a.trend} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Leads by country" description="Top 12 countries. Country is only set when a source provides evidence." />
          <CardBody>
            <BarList data={a.byCountry.map((c) => ({ ...c, label: c.key === "unknown" ? "Unknown" : countryName(c.key) }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Leads by region" />
          <CardBody>
            <BarList data={a.byRegion} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Leads by industry" description="Top 10" />
          <CardBody>
            <BarList data={a.byIndustry} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Leads by source" description="The data source that discovered each lead" />
          <CardBody>
            <BarList data={a.bySource} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Lead quality distribution" description="Qualification categories — not purchase probabilities" />
          <CardBody>
            <BarList data={a.quality} ordinal />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Contact availability" description={`Leads saved in period with each contact type (of ${a.contact.total}). A lead can appear in several rows.`} />
          <CardBody>
            <BarList data={a.contact.rows} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="CRM pipeline" description="Active leads by status" />
          <CardBody>
            <BarList data={a.pipeline} emptyText="No leads in the pipeline yet." />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Data source reliability" description="Discovery runs per source in this period" />
          <CardBody>
            <StackedBars
              data={jobs.reliability}
              xKey="label"
              layout="vertical"
              series={[
                { key: "succeeded", label: "Succeeded", color: "var(--status-good)" },
                { key: "failed", label: "Failed / retrying", color: "var(--status-critical)" },
              ]}
              emptyText="No discovery runs in this period."
            />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Monitoring activity" description="Background jobs created per day, by outcome" />
          <CardBody>
            <StackedBars
              data={jobs.activity}
              xKey="date"
              series={[
                { key: "succeeded", label: "Succeeded", color: "var(--status-good)" },
                { key: "failed", label: "Failed", color: "var(--status-critical)" },
                { key: "pending", label: "Queued / running", color: "var(--neutral-mark)" },
              ]}
              emptyText="No background jobs ran in this period."
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
