import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { primaryPlatform } from "@/lib/analysis/detect";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { EmptyState, Notice } from "@/components/ui/states";
import { fmtDate } from "@/components/ui/misc";
import { AnalyzeForm } from "./forms";

export const metadata = { title: "Website analysis" };

export default async function WebsitesPage() {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  // RLS limits analyses to businesses this workspace can see; restrict further to its own leads or private businesses.
  const rows = await withTenant(ws, (tx) =>
    tx
      .select({ a: schema.websiteAnalyses, name: schema.businesses.name, owner: schema.businesses.ownerWorkspaceId, leadId: schema.leads.id })
      .from(schema.websiteAnalyses)
      .innerJoin(schema.businesses, eq(schema.businesses.id, schema.websiteAnalyses.businessId))
      .leftJoin(schema.leads, eq(schema.leads.businessId, schema.businesses.id))
      .orderBy(desc(schema.websiteAnalyses.analyzedAt))
      .limit(300),
  );
  const mine = rows.filter((r) => r.leadId || r.owner === ws).slice(0, 100);

  return (
    <>
      <PageHeader title="Website analysis" description="Fetches the public homepage (obeying robots.txt) to detect technologies, measured technical issues and published contact details." />
      <Card className="mb-6">
        <CardHeader title="Analyze a website" description="Checks SSL, HTTP status, response time, metadata, mobile viewport, accessibility basics, outdated libraries and a sample of internal links." />
        <CardBody>
          <AnalyzeForm disabled={!hasRole(ctx, "member")} />
          <p className="mt-3 text-xs text-muted">Technical findings describe the website only. They do not reveal whether the owner intends to buy services.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recent analyses" description="Websites of your leads and websites you analyzed in this workspace." />
        {mine.length === 0 ? (
          <EmptyState title="No analyses yet" description="Analyze a URL above, or save leads with websites — they are analyzed automatically." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Website</TH>
                <TH>Status</TH>
                <TH>Platform</TH>
                <TH>Issues</TH>
                <TH>Opportunities</TH>
                <TH>Analyzed</TH>
              </tr>
            </THead>
            <tbody>
              {mine.map(({ a, name, leadId }) => {
                const high = a.issues.filter((i) => i.severity === "high").length;
                return (
                  <TR key={a.id}>
                    <TD>
                      <Link href={`/app/websites/${a.id}`} className="font-medium text-accent hover:underline">
                        {name}
                      </Link>
                      <p className="text-xs text-muted">{(a.finalUrl ?? a.url).replace(/^https?:\/\//, "").slice(0, 50)}</p>
                    </TD>
                    <TD>{a.reachable ? <Badge tone="success">Online{a.httpStatus ? ` · ${a.httpStatus}` : ""}</Badge> : <Badge tone="danger">{a.error?.includes("robots") ? "Skipped (robots.txt)" : "Unreachable"}</Badge>}</TD>
                    <TD className="text-muted">{primaryPlatform(a.technologies) ?? "—"}</TD>
                    <TD>
                      <span className="tabular">{a.issues.length}</span>
                      {high ? <span className="ml-1 text-xs text-danger">({high} high)</span> : null}
                    </TD>
                    <TD className="text-xs text-muted">{a.opportunities.map((o) => o.title).slice(0, 2).join("; ") || "—"}</TD>
                    <TD className="whitespace-nowrap text-xs text-muted">
                      {fmtDate(a.analyzedAt, true)}
                      {leadId ? (
                        <>
                          {" · "}
                          <Link href={`/app/leads/${leadId}`} className="text-accent hover:underline">
                            lead
                          </Link>
                        </>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <Notice className="mt-4">
        Turn on <Link href="/app/integrations" className="text-accent hover:underline">Google PageSpeed Insights</Link> (free) to add Lighthouse performance and accessibility measurements.
      </Notice>
    </>
  );
}
