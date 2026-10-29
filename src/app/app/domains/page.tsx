import Link from "next/link";
import { and, desc, eq, gte, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { sourceName } from "@/lib/providers/registry";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { EmptyState, Notice } from "@/components/ui/states";
import { fmtDate } from "@/components/ui/misc";
import { DomainLookupForm } from "./lookup-form";

export const metadata = { title: "Domain intelligence" };

export default async function DomainsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const sp = await searchParams;
  const D = schema.domains;
  const B = schema.businesses;
  const conds: SQL[] = [isNotNull(D.businessId), or(isNotNull(schema.leads.id), eq(B.ownerWorkspaceId, ws))!];
  if (sp.tld) conds.push(ilike(D.tld, sp.tld.replace(/^\./, "")));
  const days = Number(sp.registeredWithin);
  if (days > 0) conds.push(gte(D.registeredAt, new Date(Date.now() - days * 86400_000)));
  if (sp.status === "online") conds.push(eq(D.websiteStatus, "online"));
  if (sp.status === "offline") conds.push(sql`${D.websiteStatus} is not null and ${D.websiteStatus} <> 'online'`);
  if (sp.status === "unchecked") conds.push(sql`${D.websiteStatus} is null`);

  const rows = await withTenant(ws, (tx) =>
    tx
      .select({ d: D, business: B.name, leadId: schema.leads.id })
      .from(D)
      .innerJoin(B, eq(B.id, D.businessId))
      .leftJoin(schema.leads, and(eq(schema.leads.businessId, B.id), eq(schema.leads.workspaceId, ws)))
      .where(and(...conds))
      .orderBy(desc(D.firstDiscoveredAt))
      .limit(200),
  );

  return (
    <>
      <PageHeader
        title="Domain intelligence"
        description="Registration data from official RDAP services, DNS records, SSL and website status for domains linked to your leads."
        actions={
          <Button asChild variant="secondary">
            <Link href="/app/discover?provider=crtsh">Find newly observed domains</Link>
          </Button>
        }
      />
      <Notice className="mb-6" tone="warning">
        A newly registered domain or new TLS certificate is an opportunity signal only. It does not prove that someone bought hosting, launched a business or needs development services. Registrant personal data is redacted by registries and is never collected.
      </Notice>
      <Card className="mb-6">
        <CardHeader title="Look up a domain" description="RDAP registration date, registrar and status, DNS A/MX records, plus an optional website analysis." />
        <CardBody>
          <DomainLookupForm disabled={!hasRole(ctx, "member")} />
        </CardBody>
      </Card>
      <form className="mb-4 flex flex-wrap items-end gap-2" action="/app/domains">
        <label className="text-xs text-muted">
          Extension
          <Input name="tld" defaultValue={sp.tld ?? ""} placeholder="com" className="mt-1 w-28" />
        </label>
        <label className="text-xs text-muted">
          Registered within
          <Select name="registeredWithin" defaultValue={sp.registeredWithin ?? ""} className="mt-1 w-40">
            <option value="">Any time</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </Select>
        </label>
        <label className="text-xs text-muted">
          Website status
          <Select name="status" defaultValue={sp.status ?? ""} className="mt-1 w-40">
            <option value="">Any</option>
            <option value="online">Online</option>
            <option value="offline">Error / unreachable</option>
            <option value="unchecked">Not checked</option>
          </Select>
        </label>
        <Button type="submit">Filter</Button>
        <Button asChild variant="ghost">
          <Link href="/app/domains">Reset</Link>
        </Button>
      </form>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No domains yet" description="Domains appear when you save leads with websites, look up a domain above, or run a Certificate Transparency discovery." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Domain</TH>
                <TH>Registered</TH>
                <TH>First discovered</TH>
                <TH>Source</TH>
                <TH>Website</TH>
                <TH>SSL</TH>
                <TH>DNS</TH>
                <TH>Last checked</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map(({ d, business, leadId }) => (
                <TR key={d.id}>
                  <TD>
                    <p className="font-medium">{d.domain}</p>
                    <p className="text-xs text-muted">
                      {leadId ? (
                        <Link href={`/app/leads/${leadId}`} className="text-accent hover:underline">
                          {business}
                        </Link>
                      ) : (
                        business
                      )}
                    </p>
                  </TD>
                  <TD className="whitespace-nowrap text-xs">
                    {d.registeredAt ? fmtDate(d.registeredAt) : <span className="text-muted">{d.lastRdapAt ? "Not published" : "Not looked up"}</span>}
                    {d.registrar ? <p className="text-muted">{d.registrar}</p> : null}
                  </TD>
                  <TD className="whitespace-nowrap text-xs text-muted">{fmtDate(d.firstDiscoveredAt)}</TD>
                  <TD className="text-xs text-muted">
                    {sourceName(d.discoveryProvider)}
                    {d.sourceRef?.startsWith("crt.sh:") ? (
                      <a className="block text-accent hover:underline" href={`https://crt.sh/?id=${d.sourceRef.slice(7)}`} target="_blank" rel="noopener noreferrer nofollow">
                        certificate
                      </a>
                    ) : null}
                  </TD>
                  <TD>{d.websiteStatus ? <Badge tone={d.websiteStatus === "online" ? "success" : "danger"}>{d.websiteStatus.replace("_", " ")}</Badge> : <span className="text-xs text-muted">—</span>}</TD>
                  <TD>
                    {d.sslStatus ? <Badge tone={d.sslStatus === "valid" ? "success" : "danger"}>{d.sslStatus}</Badge> : <span className="text-xs text-muted">—</span>}
                    {d.sslValidTo ? <p className="text-xs text-muted">to {fmtDate(d.sslValidTo)}</p> : null}
                  </TD>
                  <TD className="text-xs text-muted">{d.dnsMx?.length ? `${d.dnsMx.length} MX` : d.lastCheckedAt ? "No MX" : "—"}</TD>
                  <TD className="whitespace-nowrap text-xs text-muted">{fmtDate(d.lastCheckedAt, true)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
