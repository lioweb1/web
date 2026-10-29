import { sql, type SQL } from "drizzle-orm";
import { systemDb, withTenant } from "@/lib/db";
import { countryRegion } from "@/lib/countries";
import { sourceName } from "@/lib/providers/registry";
import { statusLabel, LEAD_STATUSES } from "@/lib/lead-constants";

export type Range = { from: Date; to: Date; countries: string[] };

/** Parse ?range=7|30|90|custom&from=&to=&country= into a concrete range (defaults to 30 days). */
export function parseRange(sp: Record<string, string | string[] | undefined>): Range & { preset: string } {
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const preset = ["7", "30", "90", "custom"].includes(get("range") ?? "") ? get("range")! : "30";
  const now = new Date();
  let from = new Date(now.getTime() - Number(preset === "custom" ? 30 : preset) * 86400_000);
  let to = now;
  if (preset === "custom") {
    const f = get("from");
    const t = get("to");
    if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) from = new Date(`${f}T00:00:00Z`);
    if (t && /^\d{4}-\d{2}-\d{2}$/.test(t)) to = new Date(`${t}T23:59:59Z`);
    if (from > to) [from, to] = [to, from];
  }
  const countries = (get("country") ?? "").split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  return { from, to, countries, preset };
}

const CONTACTED = ["contacted", "follow_up", "replied", "meeting", "won", "lost"];
const QUALIFIED = ["qualified", "contacted", "follow_up", "replied", "meeting", "won"];

function inList(values: string[]): SQL {
  return sql.join(values.map((v) => sql`${v}`), sql`, `);
}

/** Base predicate: live leads of the workspace, optionally limited to countries. */
function leadWhere(ws: string, r: Range, opts: { inRange?: boolean } = {}): SQL {
  const parts: SQL[] = [sql`l.workspace_id = ${ws}`, sql`l.archived_at is null`];
  if (opts.inRange) parts.push(sql`l.created_at between ${r.from} and ${r.to}`);
  if (r.countries.length) parts.push(sql`b.country_code in (${inList(r.countries)})`);
  return sql.join(parts, sql` and `);
}

const num = (v: unknown) => Number(v ?? 0);

export type Kpis = {
  totalLeads: number;
  newLeads: number;
  highPotential: number;
  emailsDomainValid: number;
  emailsVerified: number;
  phones: number;
  newDomains: number;
  newWebsites: number;
  qualified: number;
  contacted: number;
  won: number;
  conversionRate: number | null;
};

export async function getKpis(ws: string, r: Range): Promise<Kpis> {
  return withTenant(ws, async (tx) => {
    const base = leadWhere(ws, r);
    const res = await tx.execute<Record<string, unknown>>(sql`
      select
        count(*) as total,
        count(*) filter (where l.created_at between ${r.from} and ${r.to}) as new_leads,
        count(*) filter (where l.score >= 75) as high,
        count(*) filter (where exists (select 1 from contacts c where c.business_id = b.id and c.type = 'email' and c.verification_status = 'domain_valid')) as email_dv,
        count(*) filter (where exists (select 1 from contacts c where c.business_id = b.id and c.type = 'email' and c.verification_status = 'verified_by_provider')) as email_v,
        count(*) filter (where exists (select 1 from contacts c where c.business_id = b.id and c.type = 'phone')) as phones,
        count(*) filter (where l.created_at between ${r.from} and ${r.to} and b.has_website is true) as new_websites,
        count(*) filter (where l.status in (${inList(QUALIFIED)})) as qualified,
        count(*) filter (where l.status in (${inList(CONTACTED)})) as contacted,
        count(*) filter (where l.status = 'won') as won
      from leads l join businesses b on b.id = l.business_id
      where ${base}
    `);
    const d = await tx.execute<{ n: unknown }>(sql`
      select count(distinct d.id) as n from domains d
      join businesses b on b.domain = d.domain
      join leads l on l.business_id = b.id
      where ${base} and d.first_discovered_at between ${r.from} and ${r.to}
    `);
    const x = res.rows[0] ?? {};
    const contacted = num(x.contacted);
    const won = num(x.won);
    return {
      totalLeads: num(x.total),
      newLeads: num(x.new_leads),
      highPotential: num(x.high),
      emailsDomainValid: num(x.email_dv),
      emailsVerified: num(x.email_v),
      phones: num(x.phones),
      newDomains: num(d.rows[0]?.n),
      newWebsites: num(x.new_websites),
      qualified: num(x.qualified),
      contacted,
      won,
      conversionRate: contacted > 0 ? won / contacted : null,
    };
  });
}

export type Bucket = { key: string; label: string; value: number };

async function groupLeads(ws: string, r: Range, expr: SQL, limit = 12): Promise<{ key: string; value: number }[]> {
  return withTenant(ws, async (tx) => {
    const res = await tx.execute<{ k: string | null; n: unknown }>(sql`
      select ${expr} as k, count(*) as n
      from leads l join businesses b on b.id = l.business_id
      where ${leadWhere(ws, r, { inRange: true })}
      group by 1 order by 2 desc limit ${limit}
    `);
    return res.rows.map((row) => ({ key: row.k ?? "unknown", value: num(row.n) }));
  });
}

export async function getAnalytics(ws: string, r: Range) {
  const [byCountry, byIndustry, bySource, trendRows, quality, contact, pipeline] = await Promise.all([
    groupLeads(ws, r, sql`b.country_code`, 250),
    groupLeads(ws, r, sql`coalesce(b.industry, 'Unknown')`, 10),
    groupLeads(ws, r, sql`coalesce(l.discovery_provider, 'manual')`, 20),
    withTenant(ws, (tx) =>
      tx.execute<{ d: string; n: unknown }>(sql`
        select to_char(date_trunc('day', l.created_at at time zone 'UTC'), 'YYYY-MM-DD') as d, count(*) as n
        from leads l join businesses b on b.id = l.business_id
        where ${leadWhere(ws, r, { inRange: true })} group by 1 order by 1`),
    ),
    withTenant(ws, (tx) =>
      tx.execute<{ k: string; n: unknown }>(sql`
        select case when l.score >= 90 then 'excellent' when l.score >= 75 then 'high' when l.score >= 50 then 'moderate' when l.score >= 25 then 'low' else 'weak' end as k, count(*) as n
        from leads l join businesses b on b.id = l.business_id
        where ${leadWhere(ws, r, { inRange: true })} group by 1`),
    ),
    withTenant(ws, (tx) =>
      tx.execute<Record<string, unknown>>(sql`
        select
          count(*) filter (where exists (select 1 from contacts c where c.business_id = b.id and c.type = 'email' and c.verification_status = 'verified_by_provider')) as verified,
          count(*) filter (where exists (select 1 from contacts c where c.business_id = b.id and c.type = 'email' and c.verification_status = 'domain_valid')) as domain_valid,
          count(*) filter (where exists (select 1 from contacts c where c.business_id = b.id and c.type = 'email' and c.verification_status in ('unverified','unknown'))) as unverified,
          count(*) filter (where exists (select 1 from contacts c where c.business_id = b.id and c.type = 'phone')) as phone,
          count(*) filter (where exists (select 1 from contacts c where c.business_id = b.id and c.type in ('contact_page','linkedin','facebook','instagram','x'))) as other,
          count(*) filter (where not exists (select 1 from contacts c where c.business_id = b.id and not (c.type = 'email' and c.verification_status = 'invalid'))) as none,
          count(*) as total
        from leads l join businesses b on b.id = l.business_id
        where ${leadWhere(ws, r, { inRange: true })}`),
    ),
    withTenant(ws, (tx) =>
      tx.execute<{ k: string; n: unknown }>(sql`
        select l.status as k, count(*) as n from leads l join businesses b on b.id = l.business_id
        where ${leadWhere(ws, r)} group by 1`),
    ),
  ]);

  // Region is derived from the stored country code.
  const regionMap = new Map<string, number>();
  for (const c of byCountry) {
    const region = countryRegion(c.key === "unknown" ? null : c.key) ?? "Unknown";
    regionMap.set(region, (regionMap.get(region) ?? 0) + c.value);
  }

  // Fill missing days so the trend line is continuous.
  const trend: { date: string; value: number }[] = [];
  const counts = new Map(trendRows.rows.map((row) => [row.d, num(row.n)]));
  const days = Math.min(400, Math.ceil((r.to.getTime() - r.from.getTime()) / 86400_000));
  for (let i = days; i >= 0; i--) {
    const d = new Date(r.to.getTime() - i * 86400_000).toISOString().slice(0, 10);
    trend.push({ date: d, value: counts.get(d) ?? 0 });
  }

  const qMap = new Map(quality.rows.map((q) => [q.k, num(q.n)]));
  const QUALITY: [string, string][] = [
    ["weak", "Weak Match (0–24)"],
    ["low", "Low Potential (25–49)"],
    ["moderate", "Moderate Potential (50–74)"],
    ["high", "High Potential (75–89)"],
    ["excellent", "Excellent Match (90–100)"],
  ];
  const c = contact.rows[0] ?? {};
  const pMap = new Map(pipeline.rows.map((p) => [p.k, num(p.n)]));
  const contacted = CONTACTED.reduce((s, k) => s + (pMap.get(k) ?? 0), 0);

  return {
    byCountry: byCountry.slice(0, 12).map((x) => ({ key: x.key, label: x.key === "unknown" ? "Unknown" : x.key, value: x.value })),
    byRegion: [...regionMap.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: k, value: v })),
    byIndustry: byIndustry.map((x) => ({ key: x.key, label: x.key, value: x.value })),
    bySource: bySource.map((x) => ({ key: x.key, label: x.key === "manual" ? "Added manually" : sourceName(x.key), value: x.value })),
    trend,
    quality: QUALITY.map(([k, label]) => ({ key: k, label, value: qMap.get(k) ?? 0 })),
    contact: {
      total: num(c.total),
      rows: [
        { key: "verified", label: "Email verified by provider", value: num(c.verified) },
        { key: "domain_valid", label: "Email — domain valid", value: num(c.domain_valid) },
        { key: "unverified", label: "Email — unverified", value: num(c.unverified) },
        { key: "phone", label: "Business phone", value: num(c.phone) },
        { key: "other", label: "Contact page / social", value: num(c.other) },
        { key: "none", label: "No contact found", value: num(c.none) },
      ],
    },
    pipeline: LEAD_STATUSES.map(([k]) => ({ key: k, label: statusLabel(k), value: pMap.get(k) ?? 0 })),
    conversion: { contacted, won: pMap.get("won") ?? 0, rate: contacted ? (pMap.get("won") ?? 0) / contacted : null },
  };
}

/**
 * Job activity and source reliability. The jobs table is not tenant-scoped, so these
 * queries run on the system connection with an explicit, server-derived workspace filter.
 */
export async function getJobStats(ws: string, r: Range) {
  const db = systemDb();
  const [perDay, perProvider] = await Promise.all([
    db.execute<{ d: string; status: string; n: unknown }>(sql`
      select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as d, status, count(*) as n
      from jobs where workspace_id = ${ws} and created_at between ${r.from} and ${r.to}
      group by 1, 2 order by 1`),
    db.execute<{ p: string | null; ok: unknown; failed: unknown }>(sql`
      select payload->>'providerId' as p,
        count(*) filter (where status = 'succeeded') as ok,
        count(*) filter (where status in ('dead','failed') or (status = 'queued' and last_error is not null)) as failed
      from jobs where workspace_id = ${ws} and type = 'discovery_run' and created_at between ${r.from} and ${r.to}
      group by 1 order by 2 desc`),
  ]);
  const days = new Map<string, { date: string; succeeded: number; failed: number; pending: number }>();
  for (const row of perDay.rows) {
    const e = days.get(row.d) ?? { date: row.d, succeeded: 0, failed: 0, pending: 0 };
    if (row.status === "succeeded") e.succeeded += num(row.n);
    else if (row.status === "dead" || row.status === "failed") e.failed += num(row.n);
    else if (row.status !== "cancelled") e.pending += num(row.n);
    days.set(row.d, e);
  }
  return {
    activity: [...days.values()],
    reliability: perProvider.rows.filter((p) => p.p).map((p) => ({ key: p.p!, label: sourceName(p.p), succeeded: num(p.ok), failed: num(p.failed) })),
  };
}
