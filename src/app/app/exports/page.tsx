import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { parseFilters, filtersToQuery, searchLeads } from "@/lib/services/leads";
import { EXPORT_FIELDS } from "@/lib/services/export";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/states";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { fmtDate } from "@/components/ui/misc";
import { getLimits, getUsage } from "@/lib/plans";
import { ExportBuilder } from "@/components/crm/export-builder";

export const metadata = { title: "Exports" };

export default async function ExportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const f = parseFilters(await searchParams);
  const query = filtersToQuery(f);
  const [{ total }, history, limits, usage] = await Promise.all([
    searchLeads(ws, { ...f, pageSize: 10 }),
    withTenant(ws, (tx) =>
      tx.select({ e: schema.exportsLog, user: schema.users.name }).from(schema.exportsLog).leftJoin(schema.users, eq(schema.users.id, schema.exportsLog.userId)).where(eq(schema.exportsLog.workspaceId, ws)).orderBy(desc(schema.exportsLog.createdAt)).limit(25),
    ),
    getLimits(ws),
    getUsage(ws),
  ]);
  const used = usage.exportRowsPerMonth ?? 0;
  const limit = limits.exportRowsPerMonth;
  return (
    <>
      <PageHeader title="Exports" description="Download your leads as CSV for spreadsheets or other tools." />
      <Card className="mb-6">
        <CardHeader
          title="New export"
          description={
            query ? (
              <>
                Using filters from the leads table: <span className="font-mono">{decodeURIComponent(query).slice(0, 160)}</span> ·{" "}
                <Link href="/app/exports" className="text-accent hover:underline">
                  clear
                </Link>
              </>
            ) : (
              <>
                All active leads. To export a subset, filter or select leads on the{" "}
                <Link href="/app/leads" className="text-accent hover:underline">
                  Leads page
                </Link>{" "}
                and click Export.
              </>
            )
          }
        />
        <CardBody className="space-y-4">
          <Notice tone="info">
            {total.toLocaleString()} lead{total === 1 ? "" : "s"} match. This month: {used.toLocaleString()} of {limit < 0 ? "unlimited" : limit.toLocaleString()} export rows used.
          </Notice>
          <ExportBuilder query={query} fields={EXPORT_FIELDS.map(({ key, label, default: d }) => ({ key, label, default: d }))} matching={total} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Export history" />
        {history.length === 0 ? (
          <EmptyState title="No exports yet" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>By</TH>
                <TH>Format</TH>
                <TH className="text-right">Rows</TH>
                <TH>Fields</TH>
                <TH>Filters</TH>
              </tr>
            </THead>
            <tbody>
              {history.map(({ e, user }) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-xs">{fmtDate(e.createdAt, true)}</TD>
                  <TD className="text-xs">{user ?? "—"}</TD>
                  <TD className="text-xs">{e.format === "excel" ? "Excel CSV" : "CSV"}</TD>
                  <TD className="tabular text-right">{e.rowCount.toLocaleString()}</TD>
                  <TD className="max-w-xs truncate text-xs text-muted" title={e.fields.join(", ")}>
                    {e.fields.length} fields
                  </TD>
                  <TD className="max-w-xs truncate text-xs text-muted">{e.filters ? <Link href={`/app/exports?${e.filters}`} className="text-accent hover:underline">{decodeURIComponent(e.filters)}</Link> : "All leads"}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
