import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { schema, systemDb, withTenant } from "@/lib/db";
import { DISCOVERY_PROVIDERS, getProvider, sourceName } from "@/lib/providers/registry";
import { OSM_CATEGORIES } from "@/lib/providers/osm";
import { providerContext } from "@/lib/services/integrations";
import { workspaceTarget } from "@/lib/services/enrich";
import { existingLeadMap } from "@/lib/discovery/pipeline";
import { countryName } from "@/lib/countries";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Notice } from "@/components/ui/states";
import { fmtDate, fmtRelative } from "@/components/ui/misc";
import { AutoRefresh } from "@/components/discovery/auto-refresh";
import { DiscoverForm, type ProviderOption } from "./discover-form";
import { DiscoveryResults, type ResultRow } from "./results";
import { retryRunAction } from "./actions";

export const metadata = { title: "Discover" };

const STATUS_TONE = { queued: "info", running: "accent", succeeded: "success", failed: "danger", dead: "danger", cancelled: "neutral" } as const;

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ run?: string; provider?: string }> }) {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const sp = await searchParams;

  const providers: ProviderOption[] = await Promise.all(
    DISCOVERY_PROVIDERS.map(async (p) => {
      const c = await providerContext(ws, p.id);
      return { id: p.id, name: p.name, description: p.description, criteriaSupport: (p.criteriaSupport ?? []) as string[], supportedCountries: p.supportedCountries, pricingNote: p.pricingNote, refreshNote: p.refreshNote, enabled: c.enabled, configured: c.configured };
    }),
  );
  const target = await withTenant(ws, (tx) => workspaceTarget(tx, ws));

  const runs = await systemDb()
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.workspaceId, ws), eq(schema.jobs.type, "discovery_run"), sql`${schema.jobs.payload}->>'ruleId' is null`))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(10);
  const run = sp.run ? (runs.find((r) => r.id === sp.run) ?? (await systemDb().select().from(schema.jobs).where(and(eq(schema.jobs.id, sp.run), eq(schema.jobs.workspaceId, ws))))[0]) : undefined;
  const inProgress = runs.some((r) => r.status === "queued" || r.status === "running");

  let rows: ResultRow[] = [];
  const result = (run?.result ?? null) as { businessIds?: string[]; notes?: string[]; fetched?: number; matched?: number; newBusinesses?: number; updatedBusinesses?: number; signals?: number } | null;
  const runProvider = run ? String((run.payload as { providerId?: string }).providerId ?? "") : "";
  if (run?.status === "succeeded" && result?.businessIds?.length) {
    const ids = result.businessIds.slice(0, 500);
    rows = await withTenant(ws, async (tx) => {
      const [biz, contacts, leads, obs] = await Promise.all([
        tx.select().from(schema.businesses).where(inArray(schema.businesses.id, ids)),
        tx.select({ businessId: schema.contacts.businessId, type: schema.contacts.type }).from(schema.contacts).where(inArray(schema.contacts.businessId, ids)),
        existingLeadMap(tx, ws, ids),
        tx.selectDistinctOn([schema.sourceObservations.businessId], { businessId: schema.sourceObservations.businessId, url: schema.sourceObservations.sourceUrl })
          .from(schema.sourceObservations)
          .where(and(inArray(schema.sourceObservations.businessId, ids), eq(schema.sourceObservations.providerId, runProvider)))
          .orderBy(schema.sourceObservations.businessId, desc(schema.sourceObservations.observedAt)),
      ]);
      return biz.map((b) => ({
        id: b.id,
        name: b.name,
        location: [b.city, b.countryCode ? countryName(b.countryCode) : null].filter(Boolean).join(", "),
        category: b.industry ?? b.category,
        websiteUrl: b.websiteUrl,
        hasWebsite: b.hasWebsite,
        contacts: Array.from(new Set(contacts.filter((c) => c.businessId === b.id).map((c) => c.type))),
        sourceUrl: obs.find((o) => o.businessId === b.id)?.url ?? null,
        leadId: leads.get(b.id) ?? null,
      }));
    });
  }

  return (
    <>
      <AutoRefresh active={inProgress} />
      <PageHeader
        title="Discover businesses"
        description="Search connected, free and authorized data sources. Coverage depends on each source — results are never a complete picture of a market."
        actions={
          <Button asChild variant="secondary">
            <Link href="/app/monitoring/new">Automate with a monitoring rule</Link>
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="New discovery run" description="Runs in the background. Respects each provider's rate limits." />
          <CardBody>
            <DiscoverForm
              providers={providers}
              categories={OSM_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
              defaultCountries={target.countries}
              initialProvider={providers.find((p) => p.id === sp.provider)?.id ?? "osm"}
              canRun={hasRole(ctx, "member")}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent runs" />
          {runs.length === 0 ? (
            <EmptyState title="No runs yet" description="Your manual discovery runs will appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {runs.map((r) => {
                const p = (r.payload as { providerId?: string; criteria?: { cities?: string[]; keyword?: string; countries?: string[] } });
                const res = r.result as { matched?: number } | null;
                return (
                  <li key={r.id}>
                    <Link href={`/app/discover?run=${r.id}`} className={`block px-4 py-2.5 text-sm hover:bg-surface-2 ${r.id === run?.id ? "bg-accent-soft/40" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{sourceName(p.providerId)}</span>
                        <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                      </div>
                      <p className="truncate text-xs text-muted">
                        {[p.criteria?.keyword, p.criteria?.cities?.join(", "), p.criteria?.countries?.slice(0, 3).join(", ")].filter(Boolean).join(" · ") || "No filters"}
                      </p>
                      <p className="text-xs text-subtle">
                        {fmtRelative(r.createdAt)}
                        {res?.matched !== undefined ? ` · ${res.matched} matched` : ""}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {run ? (
        <Card className="mt-6">
          <CardHeader
            title={`Run results — ${getProvider(runProvider)?.name ?? runProvider}`}
            description={`Queued ${fmtDate(run.createdAt, true)}${run.finishedAt ? ` · finished ${fmtDate(run.finishedAt, true)}` : ""}`}
            action={<Badge tone={STATUS_TONE[run.status]}>{run.status}</Badge>}
          />
          {run.status === "queued" || run.status === "running" ? (
            <CardBody>
              <Notice>
                {run.status === "queued" ? "Waiting for a worker…" : "Fetching records from the provider…"} This page refreshes automatically.
                {run.status === "queued" && Date.now() - run.createdAt.getTime() > 60_000 ? " If it stays queued, make sure the background worker is running (npm run worker)." : ""}
              </Notice>
              {run.lastError ? <p className="mt-2 text-xs text-muted">Previous attempt failed: {run.lastError}. Retrying with backoff.</p> : null}
            </CardBody>
          ) : run.status === "failed" || run.status === "dead" || run.status === "cancelled" ? (
            <CardBody>
              <ErrorState
                title="This run did not complete"
                description={run.lastError ?? "Cancelled."}
                action={
                  hasRole(ctx, "member") ? (
                    <form action={retryRunAction}>
                      <input type="hidden" name="jobId" value={run.id} />
                      <Button size="sm" type="submit">
                        Retry
                      </Button>
                    </form>
                  ) : null
                }
              />
            </CardBody>
          ) : (
            <>
              <CardBody className="space-y-2">
                <p className="text-sm text-muted">
                  {result?.fetched ?? 0} records fetched · {result?.matched ?? 0} matched your criteria · {result?.newBusinesses ?? 0} new · {result?.updatedBusinesses ?? 0} already known (deduplicated) · {result?.signals ?? 0} signals
                </p>
                {result?.notes?.length ? (
                  <Notice tone="warning">
                    <ul className="list-disc space-y-0.5 pl-4 text-xs">
                      {result.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </Notice>
                ) : null}
                {runProvider === "osm" ? <p className="text-xs text-subtle">Data © OpenStreetMap contributors, ODbL.</p> : null}
              </CardBody>
              {rows.length ? (
                <DiscoveryResults rows={rows} providerId={runProvider} runId={run.id} canSave={hasRole(ctx, "member")} />
              ) : (
                <EmptyState title="No matching businesses" description={runProvider === "hackernews" || runProvider === "rss" ? "Posts without an identifiable business website are listed under Business signals." : "Try a broader category, another city or remove the keyword."} action={<Link className="text-sm text-accent hover:underline" href="/app/signals">View business signals</Link>} />
              )}
            </>
          )}
        </Card>
      ) : null}
    </>
  );
}
