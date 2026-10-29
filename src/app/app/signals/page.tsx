import Link from "next/link";
import { and, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { SIGNAL_LABELS } from "@/lib/lead-constants";
import { PROVIDERS, sourceName } from "@/lib/providers/registry";
import { linkedinProvider, facebookProvider } from "@/lib/providers/others";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EmptyState, Notice } from "@/components/ui/states";
import { fmtDate, Pagination } from "@/components/ui/misc";
import { CreateLeadFromSignal } from "./create-lead-dialog";
import { dismissSignalAction } from "./actions";

export const metadata = { title: "Business signals" };

const PAGE = 30;
const DEMAND = ["website_requirement", "redesign_requirement", "ecommerce_requirement", "hosting_migration"];

export default async function SignalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const S = schema.businessSignals;
  const conds: SQL[] = [eq(S.workspaceId, ws)];
  if (sp.type && SIGNAL_LABELS[sp.type]) conds.push(eq(S.type, sp.type as never));
  if (sp.provider) conds.push(eq(S.providerId, sp.provider));
  if (sp.attributed === "yes") conds.push(isNotNull(S.businessId));
  if (sp.attributed === "no") conds.push(isNull(S.businessId));
  conds.push(sp.dismissed === "1" ? isNotNull(S.dismissedAt) : isNull(S.dismissedAt));
  const where = and(...conds);

  const { rows, total, providers } = await withTenant(ws, async (tx) => {
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(S).where(where);
    const rows = await tx
      .select({ s: S, businessName: schema.businesses.name, leadId: schema.leads.id })
      .from(S)
      .leftJoin(schema.businesses, eq(schema.businesses.id, S.businessId))
      .leftJoin(schema.leads, and(eq(schema.leads.businessId, S.businessId), eq(schema.leads.workspaceId, ws)))
      .where(where)
      .orderBy(desc(sql`coalesce(${S.publishedAt}, ${S.discoveredAt})`))
      .limit(PAGE)
      .offset((page - 1) * PAGE);
    const providers = await tx.selectDistinct({ id: S.providerId }).from(S).where(eq(S.workspaceId, ws));
    return { rows, total: count, providers: providers.map((p) => p.id) };
  });
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/app/signals?${p}`;
  };
  const canEdit = hasRole(ctx, "member");

  return (
    <>
      <PageHeader title="Business signals" description="Public announcements, launches and requests for web work found by your data sources. Each signal keeps its original source and publication date." />
      <Notice className="mb-4">
        <p className="font-medium">About LinkedIn and Facebook</p>
        <p className="mt-1 text-muted">{linkedinProvider.unavailableReason}</p>
        <p className="mt-1 text-muted">{facebookProvider.unavailableReason?.split(". ").slice(-2).join(". ")}</p>
      </Notice>
      <form className="mb-4 flex flex-wrap items-end gap-2" action="/app/signals">
        <label className="text-xs text-muted">
          Classification
          <Select name="type" defaultValue={sp.type ?? ""} className="mt-1 w-52">
            <option value="">All types</option>
            {Object.entries(SIGNAL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs text-muted">
          Source
          <Select name="provider" defaultValue={sp.provider ?? ""} className="mt-1 w-52">
            <option value="">All sources</option>
            {PROVIDERS.filter((p) => providers.includes(p.id)).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs text-muted">
          Business
          <Select name="attributed" defaultValue={sp.attributed ?? ""} className="mt-1 w-44">
            <option value="">Any</option>
            <option value="yes">Linked to a business</option>
            <option value="no">Not yet identified</option>
          </Select>
        </label>
        <label className="text-xs text-muted">
          Show
          <Select name="dismissed" defaultValue={sp.dismissed ?? ""} className="mt-1 w-36">
            <option value="">Active</option>
            <option value="1">Dismissed</option>
          </Select>
        </label>
        <Button type="submit">Apply</Button>
        <Button asChild variant="ghost">
          <Link href="/app/signals">Reset</Link>
        </Button>
      </form>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="No signals yet"
            description="Signals appear when discovery runs or monitoring rules use Hacker News, RSS feeds, Companies House or OpenStreetMap."
            action={
              <Button asChild variant="primary">
                <Link href="/app/discover?provider=hackernews">Find launch signals</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(({ s, businessName, leadId }) => (
              <li key={s.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={DEMAND.includes(s.type) ? "success" : s.type === "business_launch" || s.type === "new_registration" ? "accent" : "neutral"}>{SIGNAL_LABELS[s.type] ?? s.type}</Badge>
                    {s.matchedKeywords.slice(0, 3).map((k) => (
                      <Badge key={k} tone="outline" title="Phrase that triggered the classification">
                        “{k.slice(0, 40)}”
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-1 text-sm font-medium">{s.title}</p>
                  {s.summary ? <p className="mt-0.5 line-clamp-2 text-xs text-muted">{s.summary}</p> : null}
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-subtle">
                    <span>Published: {s.publishedAt ? fmtDate(s.publishedAt) : "not stated by source"}</span>
                    <span>Discovered: {fmtDate(s.discoveredAt)}</span>
                    <span>Source: {sourceName(s.providerId)}</span>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                        Original <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </p>
                  {businessName ? (
                    <p className="mt-1 text-xs">
                      Business:{" "}
                      {leadId ? (
                        <Link href={`/app/leads/${leadId}`} className="text-accent hover:underline">
                          {businessName}
                        </Link>
                      ) : (
                        <span>{businessName} (not saved as a lead)</span>
                      )}
                    </p>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 gap-2">
                    {!s.businessId ? <CreateLeadFromSignal signalId={s.id} title={s.title} /> : null}
                    <form action={dismissSignalAction}>
                      <input type="hidden" name="signalId" value={s.id} />
                      {s.dismissedAt ? <input type="hidden" name="restore" value="1" /> : null}
                      <Button size="sm" variant="ghost" type="submit">
                        {s.dismissedAt ? "Restore" : "Dismiss"}
                      </Button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {total > PAGE ? <Pagination page={page} pageSize={PAGE} total={total} hrefFor={(p) => qs({ page: String(p) })} /> : null}
      </Card>
    </>
  );
}
