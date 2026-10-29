import Link from "next/link";
import { CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import { requireAuth } from "@/lib/auth/session";
import { PageHeader, Card, CardHeader, CardBody, KpiCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtRelative, fmtDate } from "@/components/ui/misc";
import { RangeFilter } from "@/components/charts/range-filter";
import { TrendLine } from "@/components/charts/charts";
import { getKpis, getAnalytics, parseRange } from "@/lib/queries/analytics";
import { getDashboardSide, getTargetMarkets } from "@/lib/queries/dashboard";
import { countryName } from "@/lib/countries";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireAuth();
  const sp = await searchParams;
  const range = parseRange(sp);
  const ws = ctx.workspace.id;
  const [kpis, analytics, side, markets] = await Promise.all([getKpis(ws, range), getAnalytics(ws, range), getDashboardSide(ws, ctx.user.id), getTargetMarkets(ws)]);
  const qs = new URLSearchParams({ range: range.preset, ...(range.countries.length ? { country: range.countries.join(",") } : {}) }).toString();
  const leadsHref = (extra: string) => `/app/leads?${range.countries.length ? `country=${range.countries.join(",")}&` : ""}${extra}`;
  const fromStr = range.from.toISOString().slice(0, 10);
  const o = side.onboarding;
  const showOnboarding = sp.welcome === "1" || !o.hasLeads || !o.hasRule;
  const steps = [
    { done: o.marketsCustomized, label: "Review your target markets", desc: "Premium Markets is preselected. Adjust countries anytime.", href: "/app/settings?tab=markets" },
    { done: o.testedSource, label: "Test a data source", desc: "All built-in sources are free. Run a connection test.", href: "/app/integrations" },
    { done: o.ranDiscovery, label: "Run your first discovery", desc: "Search a city on OpenStreetMap or new UK companies.", href: "/app/discover" },
    { done: o.hasRule, label: "Create a monitoring rule", desc: "Get notified automatically when new matches appear.", href: "/app/monitoring" },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${ctx.workspace.name} · ${fmtDate(range.from)} – ${fmtDate(range.to)}${range.countries.length ? ` · ${range.countries.length <= 3 ? range.countries.map(countryName).join(", ") : `${range.countries.length} countries`}` : " · all countries"}`}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={`/app/analytics?${qs}`}>Analytics</Link>
            </Button>
            <Button asChild variant="primary">
              <Link href="/app/discover">Discover leads</Link>
            </Button>
          </>
        }
      />

      {showOnboarding ? (
        <Card className="mb-6">
          <CardHeader title="Get started" description="Four steps to your first qualified leads. Everything here uses free, authorized data sources." />
          <CardBody>
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s) => (
                <li key={s.label}>
                  <Link href={s.href} className="flex h-full gap-2.5 rounded-md border border-border p-3 hover:border-border-strong hover:bg-surface-2/50">
                    {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" /> : <Circle className="mt-0.5 size-4 shrink-0 text-subtle" aria-label="To do" />}
                    <span>
                      <span className="block text-sm font-medium">{s.label}</span>
                      <span className="block text-xs text-muted">{s.desc}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}

      <RangeFilter action="/app/dashboard" preset={range.preset} from={range.from} to={range.to} countries={range.countries} markets={markets} />

      <section aria-label="Key metrics" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Total leads" value={kpis.totalLeads.toLocaleString()} hint="Active (not archived)" href={leadsHref("")} />
        <KpiCard label="New leads" value={kpis.newLeads.toLocaleString()} hint="Saved in this period" href={leadsHref(`discoveredFrom=${fromStr}`)} />
        <KpiCard label="High-potential leads" value={kpis.highPotential.toLocaleString()} hint="Score 75 or higher" href={leadsHref("scoreMin=75")} />
        <KpiCard label="Emails (domain valid / verified)" value={`${kpis.emailsDomainValid.toLocaleString()} / ${kpis.emailsVerified.toLocaleString()}`} hint="MX checks don't prove a mailbox exists" href={leadsHref("emailStatus=domain_valid")} />
        <KpiCard label="Business phone numbers" value={kpis.phones.toLocaleString()} hint="Leads with a public phone" href={leadsHref("hasPhone=1")} />
        <KpiCard label="New domains discovered" value={kpis.newDomains.toLocaleString()} hint="First seen in this period" href="/app/domains" />
        <KpiCard label="New websites discovered" value={kpis.newWebsites.toLocaleString()} hint="New leads with a website" href={leadsHref(`website=has&discoveredFrom=${fromStr}`)} />
        <KpiCard label="Qualified opportunities" value={kpis.qualified.toLocaleString()} hint="Qualified or further in pipeline" href={leadsHref("status=qualified,contacted,follow_up,replied,meeting,won")} />
        <KpiCard label="Contacted leads" value={kpis.contacted.toLocaleString()} hint="Contacted or later" href={leadsHref("status=contacted,follow_up,replied,meeting,won,lost")} />
        <KpiCard label="Conversion rate" value={kpis.conversionRate === null ? "—" : `${(kpis.conversionRate * 100).toFixed(1)}%`} hint={kpis.conversionRate === null ? "No contacted leads yet" : `${kpis.won} won of ${kpis.contacted} contacted`} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Lead discovery trend" description="Leads saved per day (UTC)" action={<Link href={`/app/analytics?${qs}`} className="text-xs text-accent hover:underline">More analytics</Link>} />
          <CardBody>
            <TrendLine data={analytics.trend} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent notifications" action={<Link href="/app/notifications" className="text-xs text-accent hover:underline">View all</Link>} />
          {side.notifications.length ? (
            <ul className="divide-y divide-border">
              {side.notifications.map((n) => (
                <li key={n.id}>
                  <Link href={n.leadId ? `/app/leads/${n.leadId}` : "/app/notifications"} className="block px-4 py-2.5 hover:bg-surface-2/50">
                    <p className="line-clamp-1 text-sm font-medium">{n.title}</p>
                    {n.body ? <p className="line-clamp-1 text-xs text-muted">{n.body}</p> : null}
                    <p className="text-[11px] text-subtle">{fmtRelative(n.createdAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No notifications" description="Monitoring rules notify you when they find qualifying businesses." />
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Monitoring rules" description="Schedules run on the background worker. Sources that only publish periodically are never shown as real-time." action={<Link href="/app/monitoring" className="text-xs text-accent hover:underline">Manage</Link>} />
          {side.rules.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Rule</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Last successful run</th>
                    <th className="px-4 py-2 font-medium">Next run</th>
                    <th className="px-4 py-2 font-medium">Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {side.rules.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">
                        <Link href="/app/monitoring" className="font-medium hover:underline">
                          {r.name}
                        </Link>
                        <p className="text-xs text-muted">{r.frequency}</p>
                      </td>
                      <td className="px-4 py-2">{r.active ? <Badge tone="success">Active</Badge> : <Badge>Paused</Badge>}</td>
                      <td className="px-4 py-2 text-muted">{fmtRelative(r.lastSuccessAt)}</td>
                      <td className="px-4 py-2 text-muted">{r.active && r.nextRunAt ? fmtRelative(r.nextRunAt) : "—"}</td>
                      <td className="max-w-xs px-4 py-2">
                        {r.lastError ? (
                          <span className="inline-flex items-start gap-1 text-xs text-danger">
                            <AlertTriangle className="mt-0.5 size-3 shrink-0" /> <span className="line-clamp-2">{r.lastError}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-subtle">None</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No monitoring rules yet"
              description="Create a rule to check data sources on a schedule and save matching leads automatically."
              action={
                <Button asChild variant="primary" size="sm">
                  <Link href="/app/monitoring">Create a rule</Link>
                </Button>
              }
            />
          )}
        </Card>
      </div>
    </>
  );
}
