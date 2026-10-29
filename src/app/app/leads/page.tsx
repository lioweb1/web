import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { Upload, Filter, Users } from "lucide-react";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { parseFilters, filtersToQuery, searchLeads, type LeadFilters } from "@/lib/services/leads";
import { LEAD_STATUSES, PRIORITIES, SIGNAL_LABELS } from "@/lib/lead-constants";
import { PREMIUM_MARKETS, flag, countryName } from "@/lib/countries";
import { PROVIDERS, OTHER_SOURCES } from "@/lib/providers/registry";
import { primaryPlatform } from "@/lib/analysis/detect";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { CountrySelector } from "@/components/ui/country-selector";
import { ScoreBadge, StatusBadge, VerificationBadge, Pagination, fmtDate } from "@/components/ui/misc";
import { sourceName } from "@/lib/providers/registry";
import { LeadsTable, SaveSearchButton } from "@/components/crm/leads-table";
import { saveSearchAction } from "./actions";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Leads" };

const ISSUE_CODES: [string, string][] = [
  ["missing_viewport", "Not mobile-optimized"],
  ["broken_links", "Broken links"],
  ["no_https", "No HTTPS"],
  ["ssl_invalid", "Invalid SSL"],
  ["slow_response", "Slow response"],
  ["poor_mobile_performance", "Poor mobile performance"],
  ["missing_meta_description", "Missing meta description"],
  ["missing_title", "Missing title"],
  ["images_missing_alt", "Images missing alt text"],
  ["outdated_cms", "Outdated CMS"],
  ["outdated_jquery", "Outdated jQuery"],
  ["legacy_markup", "Legacy markup (heuristic)"],
  ["unreachable", "Unreachable"],
  ["http_error", "HTTP error"],
];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireAuth();
  const sp = await searchParams;
  const f = parseFilters(sp);
  const ws = ctx.workspace.id;
  const query = filtersToQuery(f);
  const [{ rows, total }, meta] = await Promise.all([
    searchLeads(ws, f),
    withTenant(ws, async (tx) => ({
      tags: await tx.select().from(schema.tags).where(eq(schema.tags.workspaceId, ws)).orderBy(schema.tags.name),
      lists: await tx.select({ id: schema.leadLists.id, name: schema.leadLists.name }).from(schema.leadLists).where(eq(schema.leadLists.workspaceId, ws)).orderBy(schema.leadLists.name),
      members: await tx.select({ id: schema.users.id, name: schema.users.name }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.workspaceId, ws)),
      totalLeads: (await tx.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.workspaceId, ws)).limit(1)).length,
    })),
  ]);

  // Search history: record searches (not plain paging) once per distinct query.
  if (query && (f.page ?? 1) === 1) {
    await withTenant(ws, async (tx) => {
      const [last] = await tx
        .select()
        .from(schema.searchHistory)
        .where(and(eq(schema.searchHistory.workspaceId, ws), eq(schema.searchHistory.userId, ctx.user.id)))
        .orderBy(desc(schema.searchHistory.createdAt))
        .limit(1);
      if (!last || last.query !== query) await tx.insert(schema.searchHistory).values({ workspaceId: ws, userId: ctx.user.id, kind: "leads", query, resultCount: total });
    });
  }

  const canEdit = hasRole(ctx, "member");
  const href = (patch: Partial<LeadFilters>) => {
    const q = filtersToQuery({ ...f, ...patch, page: 1 });
    return q ? `/app/leads?${q}` : "/app/leads";
  };
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const quick: { label: string; patch: Partial<LeadFilters>; active: boolean }[] = [
    { label: "High potential (75+)", patch: { scoreMin: f.scoreMin === 75 ? undefined : 75 }, active: f.scoreMin === 75 },
    { label: "No website", patch: { website: f.website === "none" ? undefined : "none" }, active: f.website === "none" },
    { label: "Has email", patch: { hasEmail: f.hasEmail ? undefined : true }, active: !!f.hasEmail },
    { label: "Domain-valid email", patch: { emailStatus: f.emailStatus === "domain_valid" ? undefined : "domain_valid" }, active: f.emailStatus === "domain_valid" },
    { label: "New this week", patch: { discoveredFrom: f.discoveredFrom === weekAgo ? undefined : weekAgo }, active: f.discoveredFrom === weekAgo },
    { label: "Follow-up due", patch: { followUpDue: f.followUpDue ? undefined : true }, active: !!f.followUpDue },
    {
      label: "Premium Markets",
      patch: { country: f.country?.length === PREMIUM_MARKETS.length ? undefined : [...PREMIUM_MARKETS] },
      active: f.country?.length === PREMIUM_MARKETS.length && PREMIUM_MARKETS.every((c) => f.country!.includes(c)),
    },
  ];
  const activeCount = Object.entries(f).filter(([k, v]) => !["page", "pageSize", "sort"].includes(k) && v !== undefined && !(Array.isArray(v) && !v.length)).length;

  const tableRows = rows.map((r) => {
    const platform = r.analysis ? primaryPlatform(r.analysis.technologies) : null;
    return {
      id: r.lead.id,
      name: r.business.name,
      cells: [
        <div key="n" className="min-w-48">
          <Link href={`/app/leads/${r.lead.id}`} className="font-medium text-fg hover:text-accent hover:underline">
            {r.business.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {r.lead.archivedAt ? <Badge tone="outline">Archived</Badge> : null}
            {r.tags.slice(0, 3).map((t) => (
              <Badge key={t.id} tone="outline">
                {t.name}
              </Badge>
            ))}
          </div>
        </div>,
        <ScoreBadge key="s" score={r.lead.score} />,
        <StatusBadge key="st" status={r.lead.status} />,
        <div key="c" className="min-w-40 space-y-0.5 text-xs">
          {r.email ? (
            <div className="flex items-center gap-1.5">
              <span className="max-w-44 truncate">{r.email.value}</span>
              <VerificationBadge status={r.email.verificationStatus} />
            </div>
          ) : (
            <span className="text-subtle">No email</span>
          )}
          {r.phone ? <div className="text-muted">{r.phone.value}</div> : null}
        </div>,
        <div key="w" className="min-w-36 text-xs">
          {r.business.websiteUrl ? (
            <a href={r.business.websiteUrl} target="_blank" rel="noopener noreferrer nofollow" className="block max-w-44 truncate text-accent hover:underline">
              {r.business.domain ?? r.business.websiteUrl}
            </a>
          ) : (
            <span className="text-subtle">{r.business.hasWebsite === false ? "No website listed" : "Unknown"}</span>
          )}
          {r.analysis && !r.analysis.reachable ? <Badge tone="danger">Unreachable</Badge> : platform ? <span className="text-muted">{platform}</span> : null}
        </div>,
        <span key="l" className="whitespace-nowrap text-xs">
          {r.business.countryCode ? (
            <>
              <span aria-hidden>{flag(r.business.countryCode)}</span> {r.business.city ? `${r.business.city}, ` : ""}
              {r.business.countryCode}
            </>
          ) : (
            <span className="text-subtle">{r.business.city ?? "Unknown"}</span>
          )}
        </span>,
        <span key="src" className="whitespace-nowrap text-xs text-muted">
          {sourceName(r.lead.discoveryProvider)}
        </span>,
        <span key="d" className="tabular whitespace-nowrap text-xs text-muted">
          {fmtDate(r.lead.createdAt)}
        </span>,
      ],
    };
  });

  const sortLink = (key: "score" | "name" | "created") => {
    const cur = f.sort ?? "-score";
    const next = key === "score" ? (cur === "-score" ? "score" : "-score") : key === "name" ? (cur === "name" ? "-name" : "name") : cur === "-created" ? "created" : "-created";
    const arrow = cur === key || cur === `-${key}` ? (cur.startsWith("-") ? " ↓" : " ↑") : "";
    return (
      <Link href={href({ sort: next as LeadFilters["sort"] })} className="hover:text-fg">
        {key === "score" ? "Score" : key === "name" ? "Business" : "Discovered"}
        {arrow}
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Leads"
        description="Businesses saved to your workspace. Discovery date is when LeadOrbit found the record — not the business's launch date."
        actions={
          <>
            <SaveSearchButton query={query} action={saveSearchAction} />
            {canEdit ? (
              <Button asChild size="sm">
                <Link href="/app/leads/import">
                  <Upload /> Import CSV
                </Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="primary">
              <Link href={`/app/exports${query ? `?${query}` : ""}`}>Export</Link>
            </Button>
          </>
        }
      />

      <form method="get" action="/app/leads" className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Input name="q" defaultValue={f.q ?? ""} placeholder="Search name, domain, city, category or notes…" aria-label="Keyword" className="sm:max-w-md" />
        {Object.entries(Object.fromEntries(new URLSearchParams(filtersToQuery({ ...f, q: undefined })))).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Button type="submit">Search</Button>
      </form>

      <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Quick filters">
        {quick.map((q) => (
          <Link key={q.label} href={href(q.patch)} aria-pressed={q.active} className={cn("rounded-full border px-2.5 py-1 text-xs", q.active ? "border-accent bg-accent-soft text-accent-text" : "border-border bg-surface text-muted hover:text-fg")}>
            {q.label}
          </Link>
        ))}
        {activeCount ? (
          <Link href="/app/leads" className="px-2 py-1 text-xs text-accent hover:underline">
            Clear all
          </Link>
        ) : null}
      </div>

      <details className="group mb-4 rounded-lg border border-border bg-surface" open={activeCount > 1 || undefined}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium">
          <Filter className="size-4 text-muted" /> Filters {activeCount ? <Badge tone="accent">{activeCount} active</Badge> : null}
          <span className="ml-auto text-xs text-muted group-open:hidden">Show</span>
        </summary>
        <FiltersForm f={f} tags={meta.tags} lists={meta.lists} members={meta.members} />
      </details>

      <Card>
        {rows.length === 0 ? (
          meta.totalLeads === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title="No leads yet"
              description="Run a discovery search or create a monitoring rule to find businesses from free public sources, or import your own CSV."
              action={
                <div className="flex gap-2">
                  <Button asChild variant="primary">
                    <Link href="/app/discover">Discover businesses</Link>
                  </Button>
                  {canEdit ? (
                    <Button asChild>
                      <Link href="/app/leads/import">Import CSV</Link>
                    </Button>
                  ) : null}
                </div>
              }
            />
          ) : (
            <EmptyState title="No leads match these filters" description="Try removing a filter or broadening the keyword." action={<Link href="/app/leads" className="text-sm text-accent hover:underline">Clear filters</Link>} />
          )
        ) : (
          <>
            <LeadsTable
              rows={tableRows}
              headers={[sortLink("name"), sortLink("score"), "Status", "Contact", "Website", "Location", "Source", sortLink("created")]}
              lists={meta.lists}
              members={meta.members}
              canEdit={canEdit}
            />
            <Pagination page={f.page ?? 1} pageSize={f.pageSize ?? 25} total={total} hrefFor={(p) => `/app/leads?${filtersToQuery(f)}${filtersToQuery(f) ? "&" : ""}page=${p}`} />
          </>
        )}
      </Card>
    </>
  );
}

function FiltersForm({ f, tags, lists, members }: { f: LeadFilters; tags: { id: string; name: string }[]; lists: { id: string; name: string }[]; members: { id: string; name: string }[] }) {
  const sources = [...PROVIDERS.filter((p) => !p.unavailableReason).map((p) => [p.id, p.name]), ...Object.entries(OTHER_SOURCES).map(([k, v]) => [k, v.name])];
  const d = (k: keyof LeadFilters) => (f[k] as string | undefined) ?? "";
  const yn = (v: boolean | undefined) => (v === true ? "1" : v === false ? "0" : "");
  return (
    <form method="get" action="/app/leads" className="grid gap-4 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="q" value={f.q ?? ""} />
      <F label="Countries" id="country">
        <CountrySelector id="country" name="country" defaultValue={f.country ?? []} />
      </F>
      <F label="Region / state" id="region">
        <Input id="region" name="region" defaultValue={d("region")} />
      </F>
      <F label="City" id="city">
        <Input id="city" name="city" defaultValue={d("city")} />
      </F>
      <F label="Industry or category" id="industry">
        <Input id="industry" name="industry" defaultValue={d("industry")} placeholder="e.g. Healthcare, dentist" />
      </F>
      <F label="Business type" id="businessType">
        <Select id="businessType" name="businessType" defaultValue={d("businessType")}>
          <option value="">Any</option>
          {["Local business", "Private limited company", "Startup / product", "Website / domain", "Company"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      </F>
      <F label="Business size" id="size">
        <Select id="size" name="size" defaultValue={d("size")}>
          <option value="">Any</option>
          {["1-10", "11-50", "51-200", "201-1000", "1000+"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
      </F>
      <F label="Registered (registry date) from / to" id="launchFrom">
        <div className="flex gap-1">
          <Input id="launchFrom" type="date" name="launchFrom" defaultValue={d("launchFrom")} aria-label="Registered from" />
          <Input type="date" name="launchTo" defaultValue={d("launchTo")} aria-label="Registered to" />
        </div>
      </F>
      <F label="Domain registered from / to" id="domainFrom">
        <div className="flex gap-1">
          <Input id="domainFrom" type="date" name="domainFrom" defaultValue={d("domainFrom")} aria-label="Domain registered from" />
          <Input type="date" name="domainTo" defaultValue={d("domainTo")} aria-label="Domain registered to" />
        </div>
      </F>
      <F label="Website" id="website">
        <Select id="website" name="website" defaultValue={d("website")}>
          <option value="">Any</option>
          <option value="has">Has website</option>
          <option value="none">No website listed</option>
          <option value="unreachable">Unreachable / broken</option>
          <option value="unknown">Unknown</option>
        </Select>
      </F>
      <F label="CMS / platform" id="cms">
        <Select id="cms" name="cms" defaultValue={d("cms")}>
          <option value="">Any</option>
          {["WordPress", "Webflow", "Shopify", "Wix", "Squarespace", "Joomla", "Drupal", "WooCommerce", "Magento", "GoDaddy Website Builder", "Weebly", "Framer"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </F>
      <F label="Hosting / CDN / server" id="hosting">
        <Select id="hosting" name="hosting" defaultValue={d("hosting")}>
          <option value="">Any</option>
          {["Cloudflare", "Vercel", "Netlify", "WP Engine", "Kinsta", "GitHub Pages", "Amazon CloudFront", "nginx", "Apache", "LiteSpeed", "Microsoft IIS"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </F>
      <F label="Website issue" id="issue">
        <Select id="issue" name="issue" defaultValue={d("issue")}>
          <option value="">Any</option>
          {ISSUE_CODES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </F>
      <F label="Business email" id="hasEmail">
        <Select id="hasEmail" name="hasEmail" defaultValue={yn(f.hasEmail)}>
          <option value="">Any</option>
          <option value="1">Available</option>
          <option value="0">Not available</option>
        </Select>
      </F>
      <F label="Email verification" id="emailStatus">
        <Select id="emailStatus" name="emailStatus" defaultValue={d("emailStatus")}>
          <option value="">Any</option>
          <option value="verified_by_provider">Verified by provider</option>
          <option value="domain_valid">Domain valid</option>
          <option value="unverified">Unverified</option>
          <option value="unknown">Unknown</option>
          <option value="invalid">Invalid</option>
        </Select>
      </F>
      <F label="Business phone" id="hasPhone">
        <Select id="hasPhone" name="hasPhone" defaultValue={yn(f.hasPhone)}>
          <option value="">Any</option>
          <option value="1">Available</option>
          <option value="0">Not available</option>
        </Select>
      </F>
      <F label="Score min / max" id="scoreMin">
        <div className="flex gap-1">
          <Input id="scoreMin" type="number" min={0} max={100} name="scoreMin" defaultValue={f.scoreMin ?? ""} aria-label="Minimum score" />
          <Input type="number" min={0} max={100} name="scoreMax" defaultValue={f.scoreMax ?? ""} aria-label="Maximum score" />
        </div>
      </F>
      <F label="Discovered from / to" id="discoveredFrom">
        <div className="flex gap-1">
          <Input id="discoveredFrom" type="date" name="discoveredFrom" defaultValue={d("discoveredFrom")} aria-label="Discovered from" />
          <Input type="date" name="discoveredTo" defaultValue={d("discoveredTo")} aria-label="Discovered to" />
        </div>
      </F>
      <F label="Source provider" id="source">
        <Select id="source" name="source" defaultValue={d("source")}>
          <option value="">Any</option>
          {sources.map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
        </Select>
      </F>
      <F label="Business signal" id="signal">
        <Select id="signal" name="signal" defaultValue={d("signal")}>
          <option value="">Any</option>
          {Object.entries(SIGNAL_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </F>
      <F label="Status" id="status">
        <Select id="status" name="status" defaultValue={f.status?.[0] ?? ""}>
          <option value="">Any</option>
          {LEAD_STATUSES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </F>
      <F label="Priority" id="priority">
        <Select id="priority" name="priority" defaultValue={d("priority")}>
          <option value="">Any</option>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </Select>
      </F>
      <F label="Tag" id="tag">
        <Select id="tag" name="tag" defaultValue={d("tag")}>
          <option value="">Any</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </F>
      <F label="List" id="list">
        <Select id="list" name="list" defaultValue={d("list")}>
          <option value="">Any</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </F>
      <F label="Owner" id="owner">
        <Select id="owner" name="owner" defaultValue={d("owner")}>
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </F>
      <F label="Archived" id="archived">
        <Select id="archived" name="archived" defaultValue={d("archived")}>
          <option value="">Hide archived</option>
          <option value="include">Include archived</option>
          <option value="only">Only archived</option>
        </Select>
      </F>
      <F label="Follow-up" id="followUpDue">
        <Select id="followUpDue" name="followUpDue" defaultValue={yn(f.followUpDue)}>
          <option value="">Any</option>
          <option value="1">Due now</option>
        </Select>
      </F>
      <F label="Sort by" id="sort">
        <Select id="sort" name="sort" defaultValue={f.sort ?? "-score"}>
          <option value="-score">Score (high → low)</option>
          <option value="score">Score (low → high)</option>
          <option value="-created">Newest discovered</option>
          <option value="created">Oldest discovered</option>
          <option value="name">Name A–Z</option>
          <option value="-name">Name Z–A</option>
          <option value="followup">Follow-up date</option>
        </Select>
      </F>
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant="primary">
          Apply filters
        </Button>
        <Button asChild variant="ghost">
          <Link href="/app/leads">Reset</Link>
        </Button>
        {f.country?.length ? <span className="text-xs text-muted">Countries: {f.country.slice(0, 5).map(countryName).join(", ")}{f.country.length > 5 ? "…" : ""}</span> : null}
      </div>
    </form>
  );
}

function F({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted">
        {label}
      </Label>
      {children}
    </div>
  );
}
