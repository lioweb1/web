import Link from "next/link";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { schema, systemDb } from "@/lib/db";
import { PROVIDERS, sourceName } from "@/lib/providers/registry";
import { listIntegrations } from "@/lib/services/integrations";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { fmtDate, fmtRelative, Pagination } from "@/components/ui/misc";
import { AutoRefresh } from "@/components/discovery/auto-refresh";
import { cancelJobAction, retryJobAction } from "./actions";

export const metadata = { title: "Jobs & activity" };

const TYPES: Record<string, string> = {
  discovery_run: "Discovery run",
  qualify_business: "Qualify business",
  enrich_lead: "Enrich lead",
  analyze_business: "Analyze website",
  send_notification_email: "Email alert",
  send_digest: "Daily digest",
  deliver_webhook: "Webhook delivery",
  push_crm: "Send to CRM",
  social_scan: "Social autopilot scan",
  social_publish: "Publish social post",
  social_engage: "Social comments & metrics",
  social_telegram_poll: "Telegram approvals",
};
const STATUSES = ["queued", "running", "succeeded", "failed", "dead", "cancelled"] as const;
const TONE = { queued: "info", running: "accent", succeeded: "success", failed: "danger", dead: "danger", cancelled: "neutral" } as const;
const PAGE = 30;

function summary(type: string, r: Record<string, unknown> | null): string {
  if (!r) return "";
  if (type === "discovery_run") return `${r.fetched ?? 0} fetched, ${r.matched ?? 0} matched, ${r.newBusinesses ?? 0} new`;
  if (type === "qualify_business") return r.qualified ? `Qualified (score ${r.score})` : `Not qualified: ${r.reason ?? ""}`;
  if (type === "enrich_lead") return `Score ${r.score}${r.newContacts ? `, ${r.newContacts} new contacts` : ""}`;
  if (type === "deliver_webhook") return r.status ? `HTTP ${r.status}` : "";
  if (r.skipped) return "Skipped";
  return r.sent ? "Sent" : "";
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; page?: string }> }) {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const J = schema.jobs;
  // Jobs live outside RLS (system queue); every query here is explicitly scoped to the workspace.
  const conds: SQL[] = [eq(J.workspaceId, ws)];
  if (sp.status && (STATUSES as readonly string[]).includes(sp.status)) conds.push(eq(J.status, sp.status as (typeof STATUSES)[number]));
  if (sp.type && TYPES[sp.type]) conds.push(eq(J.type, sp.type));
  const where = and(...conds);
  const db = systemDb();
  const [[{ count }], jobs, counts, integrations] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(J).where(where),
    db.select().from(J).where(where).orderBy(desc(J.createdAt)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ status: J.status, n: sql<number>`count(*)::int` }).from(J).where(and(eq(J.workspaceId, ws), sql`${J.createdAt} > now() - interval '7 days'`)).groupBy(J.status),
    listIntegrations(ws),
  ]);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  const canEdit = hasRole(ctx, "member");
  const qs = (p: number) => `/app/jobs?${new URLSearchParams({ ...(sp.status ? { status: sp.status } : {}), ...(sp.type ? { type: sp.type } : {}), page: String(p) })}`;
  const usedProviders = PROVIDERS.filter((p) => !p.unavailableReason && integrations.some((i) => i.providerId === p.id));

  return (
    <>
      <AutoRefresh active={active} intervalMs={5000} />
      <PageHeader title="Jobs & activity" description="Background work: discovery runs, enrichment, scoring, alerts and webhooks. Failed jobs retry automatically with exponential backoff." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATUSES.map((s) => (
          <Link key={s} href={`/app/jobs?status=${s}`} className="rounded-lg border border-border bg-surface p-3 shadow-card hover:border-border-strong">
            <p className="text-xs capitalize text-muted">{s} · 7 days</p>
            <p className="tabular mt-0.5 text-lg font-semibold">{counts.find((c) => c.status === s)?.n ?? 0}</p>
          </Link>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader title="Data source status" description="“Tested” means the last connection test passed. Errors are from real requests." action={<Link href="/app/integrations" className="text-xs text-accent hover:underline">Manage</Link>} />
        {usedProviders.length === 0 ? (
          <EmptyState title="No data source activity yet" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Source</TH>
                <TH>Connection</TH>
                <TH>Last success</TH>
                <TH>Last error</TH>
                <TH>Requests today</TH>
              </tr>
            </THead>
            <tbody>
              {usedProviders.map((p) => {
                const i = integrations.find((x) => x.providerId === p.id)!;
                return (
                  <TR key={p.id}>
                    <TD className="font-medium">{p.name}</TD>
                    <TD>
                      <Badge tone={i.connectionStatus === "connected" ? "success" : i.connectionStatus === "error" ? "danger" : "outline"}>{i.connectionStatus === "connected" ? "Tested" : i.connectionStatus === "error" ? "Test failed" : "Untested"}</Badge>
                      {!i.enabled ? <Badge tone="warning" className="ml-1">Disabled</Badge> : null}
                    </TD>
                    <TD className="text-xs text-muted">{i.lastSuccessAt ? fmtRelative(i.lastSuccessAt) : "—"}</TD>
                    <TD className="max-w-md text-xs text-danger">{i.lastError && (!i.lastSuccessAt || (i.lastErrorAt && i.lastErrorAt > i.lastSuccessAt)) ? `${i.lastError} (${fmtRelative(i.lastErrorAt)})` : <span className="text-muted">—</span>}</TD>
                    <TD className="tabular text-xs">
                      {i.requestsToday}
                      {i.remainingQuota != null ? <span className="text-muted"> · {i.remainingQuota} remaining</span> : null}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/app/jobs">
        <label className="text-xs text-muted">
          Status
          <Select name="status" defaultValue={sp.status ?? ""} className="mt-1 w-40">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs text-muted">
          Type
          <Select name="type" defaultValue={sp.type ?? ""} className="mt-1 w-48">
            <option value="">All</option>
            {Object.entries(TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit">Filter</Button>
        <Button asChild variant="ghost">
          <Link href="/app/jobs">Reset</Link>
        </Button>
      </form>
      <Card>
        {jobs.length === 0 ? (
          <EmptyState title="No jobs" description="Jobs appear when you run discovery, save leads or monitoring rules fire. Make sure the worker is running: npm run worker." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Job</TH>
                <TH>Status</TH>
                <TH>Attempts</TH>
                <TH>Scheduled</TH>
                <TH>Started / finished</TH>
                <TH>Result / error</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {jobs.map((j) => {
                const p = j.payload as { providerId?: string; ruleId?: string; leadId?: string };
                return (
                  <TR key={j.id}>
                    <TD>
                      <p className="font-medium">{TYPES[j.type] ?? j.type}</p>
                      <p className="text-xs text-muted">
                        {p.providerId ? sourceName(p.providerId) : null}
                        {p.ruleId ? (
                          <>
                            {p.providerId ? " · " : ""}
                            <Link href={`/app/monitoring/${p.ruleId}`} className="text-accent hover:underline">
                              rule
                            </Link>
                          </>
                        ) : j.type === "discovery_run" ? (
                          <>
                            {" · "}
                            <Link href={`/app/discover?run=${j.id}`} className="text-accent hover:underline">
                              results
                            </Link>
                          </>
                        ) : null}
                        {p.leadId ? (
                          <>
                            {" · "}
                            <Link href={`/app/leads/${p.leadId}`} className="text-accent hover:underline">
                              lead
                            </Link>
                          </>
                        ) : null}
                      </p>
                    </TD>
                    <TD>
                      <Badge tone={TONE[j.status]}>{j.status}</Badge>
                    </TD>
                    <TD className="tabular text-xs">
                      {j.attempts}/{j.maxAttempts}
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-muted">{j.status === "queued" ? fmtRelative(j.runAt) : fmtDate(j.runAt, true)}</TD>
                    <TD className="whitespace-nowrap text-xs text-muted">
                      {j.startedAt ? fmtDate(j.startedAt, true) : "—"}
                      <br />
                      {j.finishedAt ? fmtDate(j.finishedAt, true) : ""}
                    </TD>
                    <TD className="max-w-sm text-xs">
                      {j.lastError ? <span className="text-danger">{j.lastError.slice(0, 200)}</span> : <span className="text-muted">{summary(j.type, j.result)}</span>}
                    </TD>
                    <TD>
                      {canEdit && ["failed", "dead", "cancelled"].includes(j.status) ? (
                        <form action={retryJobAction}>
                          <input type="hidden" name="jobId" value={j.id} />
                          <Button size="sm" type="submit">
                            Retry
                          </Button>
                        </form>
                      ) : canEdit && j.status === "queued" ? (
                        <form action={cancelJobAction}>
                          <input type="hidden" name="jobId" value={j.id} />
                          <Button size="sm" variant="ghost" type="submit">
                            Cancel
                          </Button>
                        </form>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
        {count > PAGE ? <Pagination page={page} pageSize={PAGE} total={count} hrefFor={qs} /> : null}
      </Card>
    </>
  );
}
