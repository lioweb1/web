import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { sourceName } from "@/lib/providers/registry";
import { listIntegrations } from "@/lib/services/integrations";
import { intervalMinutes } from "@/lib/jobs/scheduler";
import { countryName } from "@/lib/countries";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/states";
import { fmtDate, fmtRelative } from "@/components/ui/misc";
import { deleteRuleAction, runRuleNowAction, toggleRuleAction } from "./actions";

export const metadata = { title: "Monitoring rules" };

function every(mins: number | null) {
  if (mins === null) return "Manual only";
  if (mins % 10080 === 0) return `Every ${mins / 10080 === 1 ? "week" : `${mins / 10080} weeks`}`;
  if (mins % 1440 === 0) return `Every ${mins / 1440 === 1 ? "day" : `${mins / 1440} days`}`;
  if (mins % 60 === 0) return `Every ${mins / 60 === 1 ? "hour" : `${mins / 60} hours`}`;
  return `Every ${mins} min`;
}

export default async function MonitoringPage() {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const [rules, integrations] = await Promise.all([
    withTenant(ws, (tx) => tx.select().from(schema.monitoringRules).where(eq(schema.monitoringRules.workspaceId, ws)).orderBy(desc(schema.monitoringRules.createdAt))),
    listIntegrations(ws),
  ]);
  const canEdit = hasRole(ctx, "member");
  const intStatus = (id: string) => integrations.find((i) => i.providerId === id);

  return (
    <>
      <PageHeader
        title="Monitoring rules"
        description="Rules check your data sources on a schedule, enrich and score new businesses, save those that qualify and notify you. Sources update periodically, so results are not real-time."
        actions={
          canEdit ? (
            <Button asChild variant="primary">
              <Link href="/app/monitoring/new">New rule</Link>
            </Button>
          ) : null
        }
      />
      {rules.length === 0 ? (
        <Card>
          <EmptyState
            title="No monitoring rules yet"
            description="Example: “When a newly registered UK company in construction appears, score it and notify me if it reaches 60.”"
            action={
              canEdit ? (
                <Button asChild variant="primary">
                  <Link href="/app/monitoring/new">Create your first rule</Link>
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {rules.map((r) => {
            const c = r.criteria;
            const stats = r.lastRunStats;
            return (
              <Card key={r.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {r.name}
                      <Badge tone={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Paused"}</Badge>
                      {r.lastError ? <Badge tone="danger">Last run failed</Badge> : null}
                    </span>
                  }
                  description={`${every(r.active ? intervalMinutes(r) : null)} · min. score ${r.minScore}${r.contactRequirement !== "none" ? ` · requires ${r.contactRequirement === "any" ? "email or phone" : r.contactRequirement}` : ""}`}
                  action={
                    canEdit ? (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <form action={runRuleNowAction}>
                          <input type="hidden" name="ruleId" value={r.id} />
                          <Button size="sm" type="submit">
                            Run now
                          </Button>
                        </form>
                        <form action={toggleRuleAction}>
                          <input type="hidden" name="ruleId" value={r.id} />
                          <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                          <Button size="sm" variant="ghost" type="submit">
                            {r.active ? "Pause" : "Resume"}
                          </Button>
                        </form>
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/app/monitoring/${r.id}`}>Edit</Link>
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button size="sm" variant="ghost" className="text-danger">
                              Delete
                            </Button>
                          }
                          title="Delete this rule?"
                          description="Leads already saved by this rule are kept. Scheduled runs stop."
                          confirmLabel="Delete rule"
                          action={deleteRuleAction}
                          hidden={{ ruleId: r.id }}
                        />
                      </div>
                    ) : null
                  }
                />
                <div className="grid gap-4 px-4 py-3 text-sm md:grid-cols-3">
                  <div>
                    <p className="text-xs font-medium text-muted">Sources</p>
                    <ul className="mt-1 space-y-0.5">
                      {r.providerIds.map((p) => {
                        const s = intStatus(p);
                        return (
                          <li key={p} className="flex items-center gap-1.5">
                            <span>{sourceName(p)}</span>
                            {s?.connectionStatus === "connected" ? <Badge tone="success">tested</Badge> : s?.connectionStatus === "error" ? <Badge tone="danger">error</Badge> : <Badge tone="outline">untested</Badge>}
                            {s && !s.enabled ? <Badge tone="warning">disabled</Badge> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted">Criteria</p>
                    <p className="mt-1 text-xs text-fg">
                      {[
                        c.countries?.length ? (c.countries.length > 4 ? `${c.countries.length} countries` : c.countries.map(countryName).join(", ")) : "All countries",
                        c.cities?.length ? c.cities.join(", ") : null,
                        c.industries?.length ? c.industries.join(", ") : null,
                        c.keyword ? `“${c.keyword}”` : null,
                        c.websiteState === "no_website" ? "no website" : c.websiteState === "has_website" ? "has website" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="text-xs">
                    <p>
                      <span className="text-muted">Last run:</span> {r.lastRunAt ? `${fmtDate(r.lastRunAt, true)} (${fmtRelative(r.lastRunAt)})` : "never"}
                    </p>
                    <p>
                      <span className="text-muted">Last success:</span> {r.lastSuccessAt ? fmtDate(r.lastSuccessAt, true) : "—"}
                    </p>
                    <p>
                      <span className="text-muted">Next run:</span> {r.active && r.nextRunAt ? `${fmtDate(r.nextRunAt, true)} (${fmtRelative(r.nextRunAt)})` : "—"}
                    </p>
                    {stats ? (
                      <p className="mt-1 text-muted">
                        Last run: {stats.fetched ?? 0} fetched · {stats.matched ?? 0} matched · {stats.new ?? 0} new · {stats.queued ?? 0} queued for qualification
                      </p>
                    ) : null}
                    {r.lastError ? <p className="mt-1 text-danger">{r.lastError}</p> : null}
                  </div>
                </div>
              </Card>
            );
          })}
          <p className="text-xs text-muted">
            Job history, retries and failures: <Link href="/app/jobs" className="text-accent hover:underline">Jobs & activity</Link>.
          </p>
        </div>
      )}
    </>
  );
}
