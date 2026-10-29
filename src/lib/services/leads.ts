import { and, asc, desc, eq, inArray, isNull, isNotNull, sql, type SQL } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/lib/db";
import { assertCountBelow } from "@/lib/plans";

import { statusLabel, PRIORITIES, type LeadStatus } from "@/lib/lead-constants";
export { LEAD_STATUSES, statusLabel, PRIORITIES, type LeadStatus } from "@/lib/lead-constants";

const L = schema.leads;
const B = schema.businesses;

/* ------------------------------------------------------------------ */
/* Filters                                                              */
/* ------------------------------------------------------------------ */

export type LeadFilters = {
  q?: string;
  country?: string[];
  region?: string;
  city?: string;
  industry?: string;
  businessType?: string;
  size?: string;
  launchFrom?: string;
  launchTo?: string;
  domainFrom?: string;
  domainTo?: string;
  website?: "has" | "none" | "unreachable" | "unknown";
  cms?: string;
  hosting?: string;
  issue?: string;
  hasEmail?: boolean;
  emailStatus?: string;
  hasPhone?: boolean;
  scoreMin?: number;
  scoreMax?: number;
  discoveredFrom?: string;
  discoveredTo?: string;
  source?: string;
  signal?: string;
  status?: string[];
  priority?: string;
  tag?: string;
  list?: string;
  owner?: string;
  archived?: "only" | "include";
  followUpDue?: boolean;
  ids?: string[];
  sort?: "score" | "-score" | "created" | "-created" | "name" | "-name" | "followup";
  page?: number;
  pageSize?: number;
};

/** Parse filters from URL search params (the canonical serialized form for saved searches). */
export function parseFilters(sp: URLSearchParams | Record<string, string | string[] | undefined>): LeadFilters {
  const get = (k: string): string | undefined => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const list = (k: string) => get(k)?.split(",").map((s) => s.trim()).filter(Boolean);
  const num = (k: string) => (get(k) !== undefined && get(k) !== "" && Number.isFinite(Number(get(k))) ? Number(get(k)) : undefined);
  const bool = (k: string) => (get(k) === "1" ? true : get(k) === "0" ? false : undefined);
  const date = (k: string) => (get(k) && /^\d{4}-\d{2}-\d{2}$/.test(get(k)!) ? get(k) : undefined);
  const one = <T extends string>(k: string, allowed: readonly T[]) => (allowed.includes(get(k) as T) ? (get(k) as T) : undefined);
  return {
    q: get("q")?.slice(0, 200) || undefined,
    country: list("country")?.map((c) => c.toUpperCase()),
    region: get("region") || undefined,
    city: get("city") || undefined,
    industry: get("industry") || undefined,
    businessType: get("businessType") || undefined,
    size: get("size") || undefined,
    launchFrom: date("launchFrom"),
    launchTo: date("launchTo"),
    domainFrom: date("domainFrom"),
    domainTo: date("domainTo"),
    website: one("website", ["has", "none", "unreachable", "unknown"] as const),
    cms: get("cms") || undefined,
    hosting: get("hosting") || undefined,
    issue: get("issue") || undefined,
    hasEmail: bool("hasEmail"),
    emailStatus: get("emailStatus") || undefined,
    hasPhone: bool("hasPhone"),
    scoreMin: num("scoreMin"),
    scoreMax: num("scoreMax"),
    discoveredFrom: date("discoveredFrom"),
    discoveredTo: date("discoveredTo"),
    source: get("source") || undefined,
    signal: get("signal") || undefined,
    status: list("status"),
    priority: get("priority") || undefined,
    tag: get("tag") || undefined,
    list: get("list") || undefined,
    owner: get("owner") || undefined,
    archived: one("archived", ["only", "include"] as const),
    followUpDue: bool("followUpDue"),
    ids: list("ids"),
    sort: one("sort", ["score", "-score", "created", "-created", "name", "-name", "followup"] as const),
    page: Math.max(1, num("page") ?? 1),
    pageSize: Math.min(200, Math.max(10, num("pageSize") ?? 25)),
  };
}

export function filtersToQuery(f: LeadFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "" || k === "page" || k === "pageSize") continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(","));
    } else if (typeof v === "boolean") p.set(k, v ? "1" : "0");
    else p.set(k, String(v));
  }
  return p.toString();
}

const latestAnalysis = sql`(select wa.id from website_analyses wa where wa.business_id = ${B.id} order by wa.analyzed_at desc limit 1)`;

export function filterConditions(workspaceId: string, f: LeadFilters): SQL[] {
  const c: SQL[] = [eq(L.workspaceId, workspaceId)];
  if (f.archived === "only") c.push(isNotNull(L.archivedAt));
  else if (f.archived !== "include") c.push(isNull(L.archivedAt));
  if (f.ids?.length) c.push(inArray(L.id, f.ids));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    c.push(sql`(${B.name} ilike ${like} or ${B.domain} ilike ${like} or ${B.city} ilike ${like} or ${B.category} ilike ${like}
      or exists (select 1 from notes n where n.lead_id = ${L.id} and n.body ilike ${like}))`);
  }
  if (f.country?.length) c.push(inArray(B.countryCode, f.country));
  if (f.region) c.push(sql`${B.region} ilike ${f.region}`);
  if (f.city) c.push(sql`${B.city} ilike ${f.city}`);
  if (f.industry) c.push(sql`(${B.industry} ilike ${`%${f.industry}%`} or ${B.category} ilike ${`%${f.industry}%`})`);
  if (f.businessType) c.push(eq(B.businessType, f.businessType));
  if (f.size) c.push(eq(B.sizeBand, f.size));
  if (f.launchFrom) c.push(sql`${B.registrationDate} >= ${f.launchFrom}`);
  if (f.launchTo) c.push(sql`${B.registrationDate} <= ${f.launchTo}`);
  if (f.domainFrom || f.domainTo) {
    c.push(sql`exists (select 1 from domains d where d.domain = ${B.domain}
      ${f.domainFrom ? sql`and d.registered_at >= ${f.domainFrom}` : sql``} ${f.domainTo ? sql`and d.registered_at <= ${f.domainTo}::date + 1` : sql``})`);
  }
  if (f.website === "has") c.push(eq(B.hasWebsite, true));
  if (f.website === "none") c.push(eq(B.hasWebsite, false));
  if (f.website === "unknown") c.push(isNull(B.hasWebsite));
  if (f.website === "unreachable") c.push(sql`exists (select 1 from website_analyses wa where wa.id = ${latestAnalysis} and not wa.reachable)`);
  if (f.cms) c.push(sql`exists (select 1 from website_analyses wa, jsonb_array_elements(wa.technologies) t where wa.id = ${latestAnalysis} and t->>'name' ilike ${`${f.cms}%`})`);
  if (f.hosting)
    c.push(sql`exists (select 1 from website_analyses wa, jsonb_array_elements(wa.technologies) t where wa.id = ${latestAnalysis} and t->>'category' in ('Hosting','CDN','Web server') and t->>'name' ilike ${`${f.hosting}%`})`);
  if (f.issue) c.push(sql`exists (select 1 from website_analyses wa, jsonb_array_elements(wa.issues) i where wa.id = ${latestAnalysis} and i->>'code' = ${f.issue})`);
  if (f.hasEmail !== undefined) c.push(sql`${f.hasEmail ? sql`` : sql`not`} exists (select 1 from contacts ct where ct.business_id = ${B.id} and ct.type = 'email' and ct.verification_status <> 'invalid')`);
  if (f.emailStatus) c.push(sql`exists (select 1 from contacts ct where ct.business_id = ${B.id} and ct.type = 'email' and ct.verification_status = ${f.emailStatus})`);
  if (f.hasPhone !== undefined) c.push(sql`${f.hasPhone ? sql`` : sql`not`} exists (select 1 from contacts ct where ct.business_id = ${B.id} and ct.type = 'phone')`);
  if (f.scoreMin !== undefined) c.push(sql`${L.score} >= ${f.scoreMin}`);
  if (f.scoreMax !== undefined) c.push(sql`${L.score} <= ${f.scoreMax}`);
  if (f.discoveredFrom) c.push(sql`${L.createdAt} >= ${f.discoveredFrom}`);
  if (f.discoveredTo) c.push(sql`${L.createdAt} < ${f.discoveredTo}::date + 1`);
  if (f.source) c.push(sql`exists (select 1 from source_observations so where so.business_id = ${B.id} and so.provider_id = ${f.source})`);
  if (f.signal) c.push(sql`exists (select 1 from business_signals s where s.business_id = ${B.id} and s.workspace_id = ${workspaceId} and s.type = ${f.signal})`);
  if (f.status?.length) c.push(inArray(L.status, f.status as LeadStatus[]));
  if (f.priority) c.push(eq(L.priority, f.priority as (typeof PRIORITIES)[number]));
  if (f.tag) c.push(sql`exists (select 1 from lead_tags lt where lt.lead_id = ${L.id} and lt.tag_id = ${f.tag})`);
  if (f.list) c.push(sql`exists (select 1 from lead_list_items li where li.lead_id = ${L.id} and li.list_id = ${f.list})`);
  if (f.owner === "none") c.push(isNull(L.ownerUserId));
  else if (f.owner) c.push(eq(L.ownerUserId, f.owner));
  if (f.followUpDue) c.push(sql`${L.followUpAt} <= now()`);
  return c;
}

function orderBy(f: LeadFilters) {
  switch (f.sort) {
    case "score": return [asc(L.score), desc(L.createdAt)];
    case "created": return [asc(L.createdAt)];
    case "-created": return [desc(L.createdAt)];
    case "name": return [asc(B.name)];
    case "-name": return [desc(B.name)];
    case "followup": return [sql`${L.followUpAt} asc nulls last`];
    default: return [desc(L.score), desc(L.createdAt)];
  }
}

export type LeadRow = Awaited<ReturnType<typeof searchLeads>>["rows"][number];

export async function searchLeads(workspaceId: string, f: LeadFilters, opts: { all?: boolean } = {}) {
  return withTenant(workspaceId, async (tx) => {
    const where = and(...filterConditions(workspaceId, f));
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(L).innerJoin(B, eq(B.id, L.businessId)).where(where);
    const q = tx.select({ lead: L, business: B }).from(L).innerJoin(B, eq(B.id, L.businessId)).where(where).orderBy(...orderBy(f));
    const base = opts.all ? await q.limit(50_000) : await q.limit(f.pageSize ?? 25).offset(((f.page ?? 1) - 1) * (f.pageSize ?? 25));
    const leadIds = base.map((r) => r.lead.id);
    const bizIds = base.map((r) => r.business.id);
    const [contacts, tagRows, analyses] = await Promise.all([
      bizIds.length ? tx.select().from(schema.contacts).where(inArray(schema.contacts.businessId, bizIds)) : [],
      leadIds.length
        ? tx.select({ leadId: schema.leadTags.leadId, tag: schema.tags }).from(schema.leadTags).innerJoin(schema.tags, eq(schema.tags.id, schema.leadTags.tagId)).where(inArray(schema.leadTags.leadId, leadIds))
        : [],
      bizIds.length
        ? tx
            .selectDistinctOn([schema.websiteAnalyses.businessId], { businessId: schema.websiteAnalyses.businessId, reachable: schema.websiteAnalyses.reachable, technologies: schema.websiteAnalyses.technologies, issues: schema.websiteAnalyses.issues, analyzedAt: schema.websiteAnalyses.analyzedAt })
            .from(schema.websiteAnalyses)
            .where(inArray(schema.websiteAnalyses.businessId, bizIds))
            .orderBy(schema.websiteAnalyses.businessId, desc(schema.websiteAnalyses.analyzedAt))
        : [],
    ]);
    const rows = base.map(({ lead, business }) => {
      const cs = contacts.filter((c) => c.businessId === business.id);
      const email = cs.filter((c) => c.type === "email" && c.verificationStatus !== "invalid").sort((a, b) => rankEmail(b.verificationStatus) - rankEmail(a.verificationStatus))[0] ?? null;
      return {
        lead,
        business,
        email,
        phone: cs.find((c) => c.type === "phone") ?? null,
        contacts: cs,
        tags: tagRows.filter((t) => t.leadId === lead.id).map((t) => t.tag),
        analysis: analyses.find((a) => a.businessId === business.id) ?? null,
      };
    });
    return { rows, total: count };
  });
}

function rankEmail(s: string) {
  return { verified_by_provider: 4, domain_valid: 3, unverified: 2, unknown: 1, invalid: 0 }[s] ?? 0;
}

/* ------------------------------------------------------------------ */
/* Mutations                                                            */
/* ------------------------------------------------------------------ */

export async function createLead(tx: Tx, workspaceId: string, businessId: string, opts: { actorId?: string | null; ruleId?: string | null; providerId?: string | null; summary?: string }) {
  const [existing] = await tx.select().from(L).where(and(eq(L.workspaceId, workspaceId), eq(L.businessId, businessId)));
  if (existing) return { lead: existing, created: false };
  const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(L).where(and(eq(L.workspaceId, workspaceId), isNull(L.archivedAt)));
  await assertCountBelow(workspaceId, "savedLeads", count);
  const [lead] = await tx
    .insert(L)
    .values({ workspaceId, businessId, discoveredByRuleId: opts.ruleId ?? null, discoveryProvider: opts.providerId ?? null })
    .onConflictDoNothing()
    .returning();
  if (!lead) {
    const [again] = await tx.select().from(L).where(and(eq(L.workspaceId, workspaceId), eq(L.businessId, businessId)));
    return { lead: again, created: false };
  }
  await tx.insert(schema.activities).values({ workspaceId, leadId: lead.id, actorId: opts.actorId ?? null, kind: "discovery", summary: opts.summary ?? "Lead saved" });
  return { lead, created: true };
}

export type LeadPatch = { status?: LeadStatus; priority?: (typeof PRIORITIES)[number]; ownerUserId?: string | null; followUpAt?: Date | null };

export async function updateLeads(workspaceId: string, actorId: string, leadIds: string[], patch: LeadPatch) {
  if (!leadIds.length) return [];
  return withTenant(workspaceId, async (tx) => {
    const before = await tx.select().from(L).where(and(eq(L.workspaceId, workspaceId), inArray(L.id, leadIds)));
    const changed: { id: string; from: string; to: string }[] = [];
    for (const lead of before) {
      const acts: { kind: string; summary: string; metadata: Record<string, unknown> }[] = [];
      if (patch.status && patch.status !== lead.status) {
        acts.push({ kind: "status_change", summary: `Status: ${statusLabel(lead.status)} → ${statusLabel(patch.status)}`, metadata: { from: lead.status, to: patch.status } });
        changed.push({ id: lead.id, from: lead.status, to: patch.status });
      }
      if (patch.priority && patch.priority !== lead.priority) acts.push({ kind: "system", summary: `Priority set to ${patch.priority}`, metadata: {} });
      if (patch.ownerUserId !== undefined && patch.ownerUserId !== lead.ownerUserId) acts.push({ kind: "system", summary: patch.ownerUserId ? "Lead owner assigned" : "Lead owner removed", metadata: { owner: patch.ownerUserId } });
      if (patch.followUpAt !== undefined && patch.followUpAt?.getTime() !== lead.followUpAt?.getTime())
        acts.push({ kind: "task", summary: patch.followUpAt ? `Follow-up set for ${patch.followUpAt.toISOString().slice(0, 10)}` : "Follow-up cleared", metadata: {} });
      if (acts.length) await tx.insert(schema.activities).values(acts.map((a) => ({ ...a, workspaceId, leadId: lead.id, actorId })));
    }
    if (patch.ownerUserId) {
      const [m] = await tx.select().from(schema.memberships).where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, patch.ownerUserId)));
      if (!m) throw new Error("Owner must be a workspace member");
    }
    await tx.update(L).set({ ...patch, updatedAt: new Date() }).where(and(eq(L.workspaceId, workspaceId), inArray(L.id, leadIds)));
    return changed;
  });
}

export async function addNote(workspaceId: string, actorId: string, leadId: string, body: string) {
  return withTenant(workspaceId, async (tx) => {
    const [note] = await tx.insert(schema.notes).values({ workspaceId, leadId, authorId: actorId, body }).returning();
    await tx.insert(schema.activities).values({ workspaceId, leadId, actorId, kind: "note", summary: body.slice(0, 140) });
    return note;
  });
}

export async function logCommunication(workspaceId: string, actorId: string, leadId: string, kind: "email" | "call" | "meeting" | "message", summary: string, occurredAt: Date) {
  return withTenant(workspaceId, (tx) => tx.insert(schema.activities).values({ workspaceId, leadId, actorId, kind, summary, occurredAt }).returning());
}

export async function ensureTag(tx: Tx, workspaceId: string, name: string) {
  const clean = name.trim().slice(0, 40);
  const [existing] = await tx.select().from(schema.tags).where(and(eq(schema.tags.workspaceId, workspaceId), sql`lower(${schema.tags.name}) = lower(${clean})`));
  if (existing) return existing;
  const [t] = await tx.insert(schema.tags).values({ workspaceId, name: clean }).returning();
  return t;
}

export async function tagLeads(workspaceId: string, leadIds: string[], tagName: string, remove = false) {
  return withTenant(workspaceId, async (tx) => {
    const tag = await ensureTag(tx, workspaceId, tagName);
    if (remove) await tx.delete(schema.leadTags).where(and(eq(schema.leadTags.tagId, tag.id), inArray(schema.leadTags.leadId, leadIds)));
    else if (leadIds.length) await tx.insert(schema.leadTags).values(leadIds.map((leadId) => ({ workspaceId, leadId, tagId: tag.id }))).onConflictDoNothing();
    return tag;
  });
}

export async function addToList(workspaceId: string, leadIds: string[], listId: string) {
  return withTenant(workspaceId, async (tx) => {
    const [list] = await tx.select().from(schema.leadLists).where(and(eq(schema.leadLists.id, listId), eq(schema.leadLists.workspaceId, workspaceId)));
    if (!list) throw new Error("List not found");
    if (leadIds.length) await tx.insert(schema.leadListItems).values(leadIds.map((leadId) => ({ workspaceId, listId, leadId }))).onConflictDoNothing();
  });
}

export async function archiveLeads(workspaceId: string, actorId: string, leadIds: string[], archive: boolean) {
  return withTenant(workspaceId, async (tx) => {
    await tx.update(L).set({ archivedAt: archive ? new Date() : null, updatedAt: new Date() }).where(and(eq(L.workspaceId, workspaceId), inArray(L.id, leadIds)));
    if (leadIds.length) await tx.insert(schema.activities).values(leadIds.map((leadId) => ({ workspaceId, leadId, actorId, kind: "system", summary: archive ? "Archived" : "Restored from archive" })));
  });
}

export async function deleteLeads(workspaceId: string, leadIds: string[]) {
  return withTenant(workspaceId, async (tx) => {
    const res = await tx.delete(L).where(and(eq(L.workspaceId, workspaceId), inArray(L.id, leadIds))).returning({ id: L.id, businessId: L.businessId });
    // Private (imported) businesses with no remaining lead are deleted too.
    for (const r of res) {
      await tx.execute(sql`delete from businesses b where b.id = ${r.businessId} and b.owner_workspace_id = ${workspaceId} and not exists (select 1 from leads l where l.business_id = b.id)`);
    }
    return res.length;
  });
}

/**
 * Merge duplicate leads into `targetId`: notes, activities, tags, lists and tasks move to the
 * target, contacts of private businesses move to the target business, and the duplicates are removed.
 */
export async function mergeLeads(workspaceId: string, actorId: string, targetId: string, sourceIds: string[]) {
  const sources = sourceIds.filter((id) => id !== targetId);
  if (!sources.length) throw new Error("Select at least two leads to merge");
  return withTenant(workspaceId, async (tx) => {
    const all = await tx.select().from(L).where(and(eq(L.workspaceId, workspaceId), inArray(L.id, [targetId, ...sources])));
    const target = all.find((l) => l.id === targetId);
    if (!target || all.length !== sources.length + 1) throw new Error("Leads not found");
    for (const src of all.filter((l) => l.id !== targetId)) {
      await tx.update(schema.notes).set({ leadId: targetId }).where(eq(schema.notes.leadId, src.id));
      await tx.update(schema.activities).set({ leadId: targetId }).where(eq(schema.activities.leadId, src.id));
      await tx.update(schema.tasks).set({ leadId: targetId }).where(eq(schema.tasks.leadId, src.id));
      await tx.execute(sql`insert into lead_tags (workspace_id, lead_id, tag_id) select workspace_id, ${targetId}, tag_id from lead_tags where lead_id = ${src.id} on conflict do nothing`);
      await tx.execute(sql`insert into lead_list_items (workspace_id, list_id, lead_id) select workspace_id, list_id, ${targetId} from lead_list_items where lead_id = ${src.id} on conflict do nothing`);
      if (src.businessId !== target.businessId) {
        await tx.execute(sql`update contacts set business_id = ${target.businessId}
          where business_id = ${src.businessId} and exists (select 1 from businesses b where b.id = ${src.businessId} and b.owner_workspace_id = ${workspaceId})
          and not exists (select 1 from contacts c2 where c2.business_id = ${target.businessId} and c2.type = contacts.type and c2.normalized_value = contacts.normalized_value)`);
        await tx.execute(sql`update businesses set merged_into_id = ${target.businessId} where id = ${src.businessId} and owner_workspace_id = ${workspaceId}`);
      }
      await tx.delete(L).where(eq(L.id, src.id));
    }
    await tx.insert(schema.activities).values({ workspaceId, leadId: targetId, actorId, kind: "merge", summary: `Merged ${sources.length} duplicate lead${sources.length > 1 ? "s" : ""} into this one` });
  });
}

export async function createTask(workspaceId: string, actorId: string, input: { leadId: string | null; title: string; dueAt: Date | null; assigneeId: string | null }) {
  return withTenant(workspaceId, async (tx) => {
    const [t] = await tx.insert(schema.tasks).values({ workspaceId, ...input }).returning();
    if (input.leadId) await tx.insert(schema.activities).values({ workspaceId, leadId: input.leadId, actorId, kind: "task", summary: `Task: ${input.title}${input.dueAt ? ` (due ${input.dueAt.toISOString().slice(0, 10)})` : ""}` });
    return t;
  });
}

export async function completeTask(workspaceId: string, actorId: string, taskId: string, done: boolean) {
  return withTenant(workspaceId, async (tx) => {
    const [t] = await tx.update(schema.tasks).set({ completedAt: done ? new Date() : null, updatedAt: new Date() }).where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.workspaceId, workspaceId))).returning();
    if (t?.leadId && done) await tx.insert(schema.activities).values({ workspaceId, leadId: t.leadId, actorId, kind: "task", summary: `Completed: ${t.title}` });
    return t;
  });
}
