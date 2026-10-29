import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/states";
import { fmtDate } from "@/components/ui/misc";
import { ReanalyzeButton, SaveLeadButton } from "../forms";

export const metadata = { title: "Opportunity report" };

const SEV = { high: "danger", medium: "warning", low: "neutral" } as const;
const CONF = { high: "success", medium: "accent", low: "neutral" } as const;

const METRIC_LABELS: Record<string, string> = {
  titleLength: "Title length (chars)",
  hasMetaDescription: "Meta description",
  hasViewport: "Mobile viewport tag",
  h1Count: "H1 headings",
  images: "Images",
  imagesWithoutAlt: "Images without alt text",
  copyrightYear: "Footer copyright year",
  linksChecked: "Internal links checked",
  brokenLinks: "Broken links",
  lighthouse_performance: "Lighthouse performance (mobile)",
  lighthouse_accessibility: "Lighthouse accessibility",
  lighthouse_seo: "Lighthouse SEO",
  lighthouse_bestPractices: "Lighthouse best practices",
  lighthouse_lcpMs: "Largest contentful paint (ms)",
  lighthouse_cls: "Cumulative layout shift",
  lighthouse_error: "Lighthouse error",
};

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ws = ctx.workspace.id;
  const data = await withTenant(ws, async (tx) => {
    const [a] = await tx.select().from(schema.websiteAnalyses).where(eq(schema.websiteAnalyses.id, id));
    if (!a?.businessId) return null;
    const [biz] = await tx.select().from(schema.businesses).where(eq(schema.businesses.id, a.businessId));
    const [lead] = await tx.select({ id: schema.leads.id }).from(schema.leads).where(and(eq(schema.leads.businessId, a.businessId), eq(schema.leads.workspaceId, ws)));
    if (!biz || (!lead && biz.ownerWorkspaceId !== ws)) return null;
    const contacts = await tx.select().from(schema.contacts).where(and(eq(schema.contacts.businessId, a.businessId), eq(schema.contacts.providerId, "website_analyzer")));
    return { a, biz, lead, contacts };
  });
  if (!data) notFound();
  const { a, biz, lead, contacts } = data;
  const measured = a.issues.filter((i) => i.kind === "measured");
  const heuristic = a.issues.filter((i) => i.kind === "heuristic");
  const canEdit = hasRole(ctx, "member");

  return (
    <>
      <PageHeader
        title={biz.name}
        description={
          <>
            Opportunity report for{" "}
            <a href={a.finalUrl ?? a.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">
              {(a.finalUrl ?? a.url).replace(/^https?:\/\//, "")}
            </a>{" "}
            · analyzed {fmtDate(a.analyzedAt, true)}
          </>
        }
        actions={
          <>
            {lead ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/app/leads/${lead.id}`}>Open lead</Link>
              </Button>
            ) : canEdit ? (
              <SaveLeadButton businessId={biz.id} />
            ) : null}
            {canEdit ? <ReanalyzeButton businessId={biz.id} /> : null}
          </>
        }
      />
      <Notice className="mb-6">Findings describe the website&apos;s technical state. They are evidence of possible improvement opportunities, not of the owner&apos;s intent or budget.</Notice>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Overview" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt className="text-muted">Reachable</dt>
              <dd>{a.reachable ? <Badge tone="success">Yes</Badge> : <Badge tone="danger">No</Badge>}</dd>
              <dt className="text-muted">HTTP status</dt>
              <dd className="tabular">{a.httpStatus ?? "—"}</dd>
              <dt className="text-muted">HTTPS</dt>
              <dd>{a.https === null ? "—" : a.https ? "Yes" : "No"}</dd>
              <dt className="text-muted">Response time</dt>
              <dd className="tabular">{a.responseMs ? `${(a.responseMs / 1000).toFixed(1)} s` : "—"}</dd>
              <dt className="text-muted">HTML size</dt>
              <dd className="tabular">{a.pageBytes ? `${Math.round(a.pageBytes / 1024)} KB` : "—"}</dd>
              <dt className="text-muted">Page title</dt>
              <dd className="truncate" title={a.title ?? ""}>
                {a.title ?? "—"}
              </dd>
            </dl>
            {a.error ? <p className="mt-3 text-xs text-danger">{a.error}</p> : null}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Detected technologies" description="Each detection lists the evidence it is based on." />
          {a.technologies.length ? (
            <ul className="divide-y divide-border">
              {a.technologies.map((t) => (
                <li key={t.name} className="flex flex-col gap-0.5 px-4 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
                  <span className="w-44 shrink-0 font-medium">{t.name}</span>
                  <Badge tone="outline">{t.category}</Badge>
                  <span className="truncate text-xs text-muted">{t.evidence}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No technologies identified" description="The site may be custom-built, or the page could not be fetched." />
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Improvement opportunities" description="Derived only from the issues below." />
        {a.opportunities.length ? (
          <ul className="divide-y divide-border">
            {a.opportunities.map((o) => (
              <li key={o.title} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{o.title}</p>
                  <Badge tone={CONF[o.confidence]}>Confidence: {o.confidence}</Badge>
                </div>
                <p className="mt-1 text-sm">
                  <span className="text-muted">Suggested service:</span> {o.service}
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                  {o.evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No clear opportunities" description="No measured issues strong enough to suggest a service." />
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <IssueList title="Measured issues" description="Objectively checked from the page and HTTP responses." issues={measured} />
        <IssueList title="Heuristic findings (subjective)" description="Indicators such as legacy markup or an old copyright year. Treat with caution." issues={heuristic} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Measurements" />
          <CardBody>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
              {Object.entries(a.metrics)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{METRIC_LABELS[k] ?? k}</dt>
                    <dd className="tabular text-right">{typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</dd>
                  </div>
                ))}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Contact details published on the site" description="Only details the business itself publishes. Status starts as unverified." />
          {contacts.length ? (
            <ul className="divide-y divide-border text-sm">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0 truncate">
                    <span className="mr-2 text-xs uppercase text-subtle">{c.type.replace("_", " ")}</span>
                    {c.value}
                  </span>
                  {c.sourceUrl ? (
                    <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="shrink-0 text-xs text-accent hover:underline">
                      found on page
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No contact details found" />
          )}
        </Card>
      </div>
    </>
  );
}

function IssueList({ title, description, issues }: { title: string; description: string; issues: { code: string; label: string; severity: "low" | "medium" | "high"; evidence: string }[] }) {
  return (
    <Card>
      <CardHeader title={`${title} (${issues.length})`} description={description} />
      {issues.length ? (
        <ul className="divide-y divide-border">
          {issues.map((i) => (
            <li key={i.code} className="px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Badge tone={SEV[i.severity]}>{i.severity}</Badge>
                <span className="text-sm font-medium">{i.label}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted">{i.evidence}</p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="None found" />
      )}
    </Card>
  );
}
