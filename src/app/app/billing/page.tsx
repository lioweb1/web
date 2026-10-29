import { eq } from "drizzle-orm";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { schema, systemDb } from "@/lib/db";
import { PLAN_LIMITS, PLAN_FEATURES, LIMIT_LABELS, getLimits, getUsage, currentPeriod, type LimitKey, type Plan } from "@/lib/plans";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/states";
import { Input, Select, Field } from "@/components/ui/input";
import { ActionForm } from "@/components/ui/action-form";
import { saveLimitsAction } from "./actions";
import { sql } from "drizzle-orm";

export const metadata = { title: "Usage & plan" };

const METERED: LimitKey[] = ["discoveryRunsPerMonth", "websiteAnalysesPerMonth", "exportRowsPerMonth"];

export default async function BillingPage() {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const [[workspace], limits, usage, counts] = await Promise.all([
    systemDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, ws)),
    getLimits(ws),
    getUsage(ws),
    systemDb().execute<{ leads: number; rules: number; members: number }>(sql`
      select (select count(*)::int from leads where workspace_id = ${ws} and archived_at is null) as leads,
             (select count(*)::int from monitoring_rules where workspace_id = ${ws}) as rules,
             (select count(*)::int from memberships where workspace_id = ${ws}) as members`),
  ]);
  const c = counts.rows[0];
  const current: Record<LimitKey, number> = {
    savedLeads: Number(c.leads),
    monitoringRules: Number(c.rules),
    members: Number(c.members),
    discoveryRunsPerMonth: usage.discoveryRunsPerMonth ?? 0,
    websiteAnalysesPerMonth: usage.websiteAnalysesPerMonth ?? 0,
    exportRowsPerMonth: usage.exportRowsPerMonth ?? 0,
  };
  const overrides = workspace.limitOverrides as Partial<Record<LimitKey, number>>;
  const isOwner = hasRole(ctx, "owner");

  return (
    <>
      <PageHeader title="Usage & plan" description={`Usage for ${currentPeriod()} (monthly counters reset on the 1st, UTC).`} />
      <Notice className="mb-6">
        Every built-in data source is free, so there is nothing to pay for. Limits exist to respect public providers’ fair-use policies and protect your server — you can raise them below. Billing is <strong>not connected</strong>; if you later sell LeadOrbit as a service, a payment provider (e.g. Stripe Billing) can set the plan tier through a webhook after you verify its current pricing and capabilities.
      </Notice>
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Current usage" description={<>Plan tier: <Badge tone="accent">{workspace.plan}</Badge></>} />
          <CardBody className="space-y-4">
            {(Object.keys(LIMIT_LABELS) as LimitKey[]).map((k) => {
              const limit = limits[k];
              const used = current[k];
              const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
              return (
                <div key={k}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>
                      {LIMIT_LABELS[k]} {METERED.includes(k) ? <span className="text-xs text-muted">(this month)</span> : null}
                    </span>
                    <span className="tabular text-muted">
                      {used.toLocaleString()} / {limit < 0 ? "no app limit" : limit.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={LIMIT_LABELS[k]}>
                    <div className={`h-full rounded-full ${pct >= 90 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-accent"}`} style={{ width: `${limit < 0 ? 0 : pct}%` }} />
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-muted">You get a notification at 80% of any monthly limit. Public providers still apply their own rate limits regardless of these settings.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Plan tiers" />
          <CardBody className="space-y-4 text-sm">
            {(Object.keys(PLAN_LIMITS) as Plan[]).map((p) => (
              <div key={p}>
                <p className="font-medium capitalize">
                  {p} {workspace.plan === p ? <Badge tone="accent">current</Badge> : null}
                </p>
                <ul className="mt-1 list-inside list-disc text-xs text-muted">
                  {PLAN_FEATURES[p].map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Plan & limit overrides" description={isOwner ? "Leave a field empty to use the plan default. Use -1 for no app-level limit." : "Only workspace owners can change limits."} />
        <CardBody>
          <ActionForm action={saveLimitsAction}>
            <fieldset disabled={!isOwner} className="space-y-4">
              <Field label="Plan tier" htmlFor="plan" className="max-w-xs">
                <Select id="plan" name="plan" defaultValue={workspace.plan}>
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                  <option value="agency">Agency</option>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(Object.keys(LIMIT_LABELS) as LimitKey[]).map((k) => (
                  <Field key={k} label={LIMIT_LABELS[k]} htmlFor={`lim-${k}`} hint={`Plan default: ${PLAN_LIMITS[workspace.plan][k] < 0 ? "no limit" : PLAN_LIMITS[workspace.plan][k].toLocaleString()}`}>
                    <Input id={`lim-${k}`} name={k} type="number" min={-1} defaultValue={overrides[k] ?? ""} placeholder="Plan default" />
                  </Field>
                ))}
              </div>
            </fieldset>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
