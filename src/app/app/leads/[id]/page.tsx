import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { ArrowLeft, ExternalLink, RefreshCw, Calculator, Send, Archive, Trash2, ShieldOff, X, Check } from "lucide-react";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { countryName, flag } from "@/lib/countries";
import { scoreCategory } from "@/lib/scoring/score";
import { sourceName } from "@/lib/providers/registry";
import { SIGNAL_LABELS } from "@/lib/lead-constants";
import { providerContext } from "@/lib/services/integrations";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Notice, EmptyState } from "@/components/ui/states";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ScoreBadge, ScoreBar, StatusBadge, VerificationBadge, SourceLink, Timeline, fmtDate, fmtRelative } from "@/components/ui/misc";
import { LeadEditForm, NoteForm, CommunicationForm, TaskForm } from "@/components/crm/lead-forms";
import {
  updateLeadAction, addNoteAction, editNoteAction, deleteNoteAction, logCommunicationAction, tagLeadAction, listLeadAction, createTaskAction, completeTaskAction,
  reanalyzeAction, rescoreAction, hubspotAction, archiveLeadAction, deleteLeadAction, suppressAction,
} from "../actions";

export const metadata = { title: "Lead" };

const FIELD_LABELS: Record<string, string> = {
  name: "Name", websiteUrl: "Website", category: "Category", industry: "Industry", businessType: "Business type", countryCode: "Country", region: "Region", city: "City",
  address: "Address", postcode: "Postcode", registrationDate: "Registration date", phone: "Phone", email: "Email", countryEvidence: "Country evidence",
};

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const data = await withTenant(ws, async (tx) => {
    const [row] = await tx.select({ lead: schema.leads, business: schema.businesses }).from(schema.leads).innerJoin(schema.businesses, eq(schema.businesses.id, schema.leads.businessId)).where(and(eq(schema.leads.id, id), eq(schema.leads.workspaceId, ws)));
    if (!row) return null;
    const bid = row.business.id;
    const [observations, contacts, analyses, signals, notes, activities, tasks, allTags, leadTags, lists, listItems, members, domainRows] = await Promise.all([
      tx.select().from(schema.sourceObservations).where(eq(schema.sourceObservations.businessId, bid)).orderBy(desc(schema.sourceObservations.observedAt)).limit(500),
      tx.select().from(schema.contacts).where(eq(schema.contacts.businessId, bid)).orderBy(asc(schema.contacts.type)),
      tx.select().from(schema.websiteAnalyses).where(eq(schema.websiteAnalyses.businessId, bid)).orderBy(desc(schema.websiteAnalyses.analyzedAt)).limit(5),
      tx.select().from(schema.businessSignals).where(and(eq(schema.businessSignals.businessId, bid), eq(schema.businessSignals.workspaceId, ws))).orderBy(desc(schema.businessSignals.discoveredAt)),
      tx.select({ note: schema.notes, author: schema.users.name }).from(schema.notes).leftJoin(schema.users, eq(schema.users.id, schema.notes.authorId)).where(eq(schema.notes.leadId, id)).orderBy(desc(schema.notes.createdAt)),
      tx.select({ a: schema.activities, actor: schema.users.name }).from(schema.activities).leftJoin(schema.users, eq(schema.users.id, schema.activities.actorId)).where(eq(schema.activities.leadId, id)).orderBy(desc(schema.activities.occurredAt)).limit(100),
      tx.select().from(schema.tasks).where(eq(schema.tasks.leadId, id)).orderBy(asc(schema.tasks.completedAt), asc(schema.tasks.dueAt)),
      tx.select().from(schema.tags).where(eq(schema.tags.workspaceId, ws)).orderBy(schema.tags.name),
      tx.select({ tag: schema.tags }).from(schema.leadTags).innerJoin(schema.tags, eq(schema.tags.id, schema.leadTags.tagId)).where(eq(schema.leadTags.leadId, id)),
      tx.select().from(schema.leadLists).where(eq(schema.leadLists.workspaceId, ws)).orderBy(schema.leadLists.name),
      tx.select().from(schema.leadListItems).where(eq(schema.leadListItems.leadId, id)),
      tx.select({ id: schema.users.id, name: schema.users.name }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.workspaceId, ws)),
      row.business.domain ? tx.select().from(schema.domains).where(eq(schema.domains.domain, row.business.domain)) : Promise.resolve([]),
    ]);
    return { ...row, observations, contacts, analyses, signals, notes, activities, tasks, allTags, leadTags: leadTags.map((t) => t.tag), lists, listItems, members, domain: domainRows[0] ?? null };
  });
  if (!data) notFound();
  const { lead, business: b } = data;
  const canEdit = hasRole(ctx, "member");
  const isAdmin = hasRole(ctx, "admin");
  const hub = await providerContext(ws, "hubspot");
  const hubReady = hub.enabled && hub.configured;
  const analysis = data.analyses[0] ?? null;
  const suppressed = b.externalKeys.includes("suppressed");
  const providers = Array.from(new Set(data.observations.map((o) => o.providerId)));
  const obsFor = (field: string) => data.observations.find((o) => o.field === field);
  const ownerName = data.members.find((m) => m.id === lead.ownerUserId)?.name;

  const info: [string, React.ReactNode, string][] = [
    ["Website", b.websiteUrl ? <a href={b.websiteUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-accent hover:underline">{b.domain ?? b.websiteUrl}<ExternalLink className="size-3" /></a> : b.hasWebsite === false ? "No website listed by source" : "Unknown", "websiteUrl"],
    ["Country", b.countryCode ? `${flag(b.countryCode)} ${countryName(b.countryCode)}` : "Unknown", "countryCode"],
    ["Region", b.region ?? "—", "region"],
    ["City", b.city ?? "—", "city"],
    ["Address", [b.address, b.postcode].filter(Boolean).join(", ") || "—", "address"],
    ["Industry", b.industry ?? "—", "industry"],
    ["Category", b.category ?? "—", "category"],
    ["Business type", b.businessType ?? "—", "businessType"],
    ["Registration date", b.registrationDate ? `${fmtDate(b.registrationDate)} (${sourceName(b.registrationSource)})` : "Not available from a registry", "registrationDate"],
  ];

  return (
    <>
      <Link href="/app/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Leads
      </Link>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{b.name}</h1>
            <ScoreBadge score={lead.score} />
            <StatusBadge status={lead.status} />
            <Badge tone="outline">Priority: {lead.priority}</Badge>
            {lead.archivedAt ? <Badge tone="warning">Archived</Badge> : null}
            {suppressed ? <Badge tone="danger">Contact data suppressed</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            {[b.city, b.countryCode ? countryName(b.countryCode) : null].filter(Boolean).join(", ") || "Location unknown"} · Discovered by LeadOrbit {fmtDate(lead.createdAt)} via {sourceName(lead.discoveryProvider)}
            {ownerName ? ` · Owner: ${ownerName}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-subtle">The discovery date is when LeadOrbit found this record. It is not the business&apos;s launch date{b.registrationDate ? "; the registration date above comes from an official registry" : ""}.</p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <form action={reanalyzeAction}>
              <input type="hidden" name="leadId" value={lead.id} />
              <Button size="sm" type="submit" title="Re-run website analysis, RDAP and email checks in the background">
                <RefreshCw /> Re-analyze
              </Button>
            </form>
            {hubReady ? (
              <form action={hubspotAction}>
                <input type="hidden" name="leadId" value={lead.id} />
                <Button size="sm" type="submit">
                  <Send /> Send to HubSpot
                </Button>
              </form>
            ) : null}
            <form action={archiveLeadAction}>
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="archive" value={lead.archivedAt ? "0" : "1"} />
              <Button size="sm" type="submit">
                <Archive /> {lead.archivedAt ? "Restore" : "Archive"}
              </Button>
            </form>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="danger">
                  <Trash2 /> Delete
                </Button>
              }
              title="Delete this lead?"
              description="Notes, tasks and activity are permanently deleted. Shared public business data is kept for other uses."
              confirmLabel="Delete lead"
              action={deleteLeadAction}
              hidden={{ leadId: lead.id }}
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Score */}
          <Card>
            <CardHeader
              title={`Lead score: ${lead.score}/100 · ${scoreCategory(lead.score)}`}
              description="A qualification category from the evidence below — not a probability that this business will buy."
              action={
                canEdit ? (
                  <form action={rescoreAction}>
                    <input type="hidden" name="leadId" value={lead.id} />
                    <Button size="sm" type="submit" variant="ghost">
                      <Calculator /> Recalculate
                    </Button>
                  </form>
                ) : null
              }
            />
            <CardBody className="space-y-4">
              {lead.scoreFactors.length === 0 ? (
                <p className="text-sm text-muted">Not scored yet. Click Recalculate.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {lead.scoreFactors.map((f) => (
                    <li key={f.key} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-4">
                      <span className="w-56 shrink-0 text-sm font-medium">{f.label}</span>
                      <ScoreBar points={f.points} max={f.max} />
                      <span className="text-xs text-muted">{f.evidence ?? <em className="text-subtle">No evidence — 0 points</em>}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted">Confidence</p>
                  <p className="text-sm font-medium capitalize">{lead.scoreConfidence}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted">Recommended next step</p>
                  <p className="text-sm">{lead.scoreNextStep ?? "—"}</p>
                </div>
              </div>
              {lead.scoreMissing.length ? (
                <Notice tone="warning">
                  <span className="font-medium">Missing information:</span> {lead.scoreMissing.join(" · ")}
                </Notice>
              ) : null}
              <p className="text-xs text-subtle">Scored {lead.scoredAt ? fmtRelative(lead.scoredAt) : "never"}.</p>
            </CardBody>
          </Card>

          {/* Website analysis */}
          <Card>
            <CardHeader title="Website analysis" description={analysis ? `Last analyzed ${fmtDate(analysis.analyzedAt, true)} · ${analysis.finalUrl ?? analysis.url}` : undefined} />
            <CardBody>
              {!b.websiteUrl ? (
                <p className="text-sm text-muted">No website is known for this business{b.hasWebsite === false ? " — the source listing has none, which may itself be an opportunity (or the listing may be incomplete)" : ""}.</p>
              ) : !analysis ? (
                <EmptyState title="Not analyzed yet" description="Use Re-analyze to fetch the public homepage and measure technical issues." className="py-6" />
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span>
                      Status: {analysis.reachable ? <Badge tone="success">Online (HTTP {analysis.httpStatus})</Badge> : <Badge tone="danger">{analysis.error ?? "Unreachable"}</Badge>}
                    </span>
                    {analysis.https !== null ? <span>HTTPS: {analysis.https ? "yes" : "no"}</span> : null}
                    {analysis.responseMs ? <span className="tabular">Response: {(analysis.responseMs / 1000).toFixed(1)}s</span> : null}
                    {data.domain?.sslStatus ? <span>SSL: {data.domain.sslStatus}{data.domain.sslValidTo ? ` (until ${fmtDate(data.domain.sslValidTo)})` : ""}</span> : null}
                  </div>
                  {analysis.technologies.length ? (
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted">Detected technologies</p>
                      <div className="flex flex-wrap gap-1">
                        {analysis.technologies.map((t) => (
                          <Badge key={t.name} tone="outline" title={t.evidence}>
                            {t.name} <span className="text-subtle">· {t.category}</span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted">Issues ({analysis.issues.length})</p>
                    {analysis.issues.length === 0 ? (
                      <p className="text-sm text-muted">No issues detected by the checks we run.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {analysis.issues.map((i) => (
                          <li key={i.code} className="flex flex-wrap items-start gap-2 text-sm">
                            <Badge tone={i.severity === "high" ? "danger" : i.severity === "medium" ? "warning" : "neutral"}>{i.severity}</Badge>
                            <Badge tone={i.kind === "measured" ? "info" : "outline"} title={i.kind === "measured" ? "Measured by an automated check" : "Heuristic / subjective assessment"}>
                              {i.kind === "measured" ? "Measured" : "Heuristic"}
                            </Badge>
                            <span className="font-medium">{i.label}</span>
                            <span className="text-xs text-muted">{i.evidence}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {analysis.opportunities.length ? (
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted">Potential opportunities</p>
                      <ul className="space-y-2">
                        {analysis.opportunities.map((o) => (
                          <li key={o.title} className="rounded-md border border-border p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{o.title}</span>
                              <Badge tone={o.confidence === "high" ? "success" : o.confidence === "medium" ? "accent" : "neutral"}>Confidence: {o.confidence}</Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted">Suggested service: {o.service}</p>
                            <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                              {o.evidence.map((e, k) => (
                                <li key={k}>{e}</li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-subtle">Opportunities are derived only from the technical evidence above. They don&apos;t indicate that the owner intends to buy services.</p>
                    </div>
                  ) : null}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Business info */}
          <Card>
            <CardHeader title="Business information" description="Each field shows where it came from." />
            <CardBody>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {info.map(([label, value, field]) => {
                  const o = obsFor(field);
                  return (
                    <div key={label}>
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className="text-sm">{value}</dd>
                      {o ? <SourceLink providerId={o.providerId} url={o.sourceUrl} date={o.observedAt} /> : null}
                    </div>
                  );
                })}
              </dl>
              {data.domain ? (
                <div className="mt-4 border-t border-border pt-3 text-xs text-muted">
                  Domain <span className="font-medium text-fg">{data.domain.domain}</span>
                  {data.domain.registeredAt ? ` · registered ${fmtDate(data.domain.registeredAt)} (RDAP)` : " · registration date unavailable"}
                  {data.domain.registrar ? ` · ${data.domain.registrar}` : ""}
                  {data.domain.dnsMx?.length ? ` · MX: ${data.domain.dnsMx.slice(0, 2).join(", ")}` : ""}
                  {" · first seen "}
                  {fmtDate(data.domain.firstDiscoveredAt)}
                </div>
              ) : null}
            </CardBody>
          </Card>

          {/* Signals */}
          <Card>
            <CardHeader title="Related business signals" description="Public post/registration dates are shown separately from when LeadOrbit discovered them." />
            <CardBody>
              {data.signals.length === 0 ? (
                <p className="text-sm text-muted">No signals recorded for this business.</p>
              ) : (
                <ul className="space-y-3">
                  {data.signals.map((s) => (
                    <li key={s.id} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="accent">{SIGNAL_LABELS[s.type] ?? s.type}</Badge>
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:text-accent hover:underline">
                            {s.title}
                          </a>
                        ) : (
                          <span className="font-medium">{s.title}</span>
                        )}
                      </div>
                      {s.summary ? <p className="mt-0.5 text-xs text-muted">{s.summary}</p> : null}
                      <p className="mt-0.5 text-xs text-subtle">
                        {sourceName(s.providerId)} · published {s.publishedAt ? fmtDate(s.publishedAt) : "date unknown"} · discovered {fmtDate(s.discoveredAt)}
                        {s.matchedKeywords.length ? ` · matched: ${s.matchedKeywords.join(", ")}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader title={`Notes (${data.notes.length})`} />
            <CardBody className="space-y-4">
              {canEdit ? <NoteForm action={addNoteAction} leadId={lead.id} /> : null}
              <ul className="space-y-3">
                {data.notes.map(({ note, author }) => (
                  <li key={note.id} className="rounded-md border border-border p-3">
                    <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-subtle">
                      <span>
                        {author ?? "Unknown"} · {fmtDate(note.createdAt, true)}
                        {note.updatedAt.getTime() - note.createdAt.getTime() > 1000 ? " (edited)" : ""}
                      </span>
                      {canEdit ? (
                        <>
                          <details>
                            <summary className="cursor-pointer text-accent">Edit</summary>
                            <form action={editNoteAction} className="mt-2 space-y-2">
                              <input type="hidden" name="leadId" value={lead.id} />
                              <input type="hidden" name="noteId" value={note.id} />
                              <textarea name="body" defaultValue={note.body} required aria-label="Edit note" className="min-h-20 w-full rounded-md border border-border bg-surface p-2 text-sm text-fg" />
                              <Button size="sm" type="submit">
                                Save
                              </Button>
                            </form>
                          </details>
                          <ConfirmDialog trigger={<button className="text-danger hover:underline">Delete</button>} title="Delete note?" description="This cannot be undone." confirmLabel="Delete" action={deleteNoteAction} hidden={{ leadId: lead.id, noteId: note.id }} />
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader title="Activity timeline" description="Status changes, communication, discovery and system events." />
            <CardBody className="space-y-5">
              {canEdit ? (
                <div className="rounded-md border border-border p-3">
                  <p className="mb-2 text-xs font-medium text-muted">Log communication</p>
                  <CommunicationForm action={logCommunicationAction} leadId={lead.id} />
                </div>
              ) : null}
              {data.activities.length ? (
                <Timeline
                  items={data.activities.map(({ a, actor }) => ({
                    id: a.id,
                    when: a.occurredAt,
                    title: (
                      <>
                        <Badge tone="outline" className="mr-1.5">
                          {a.kind.replace("_", " ")}
                        </Badge>
                        {a.summary}
                      </>
                    ),
                    detail: actor ? `by ${actor}` : null,
                  }))}
                />
              ) : (
                <p className="text-sm text-muted">No activity yet.</p>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Pipeline" />
            <CardBody>
              <LeadEditForm action={updateLeadAction} leadId={lead.id} status={lead.status} priority={lead.priority} ownerUserId={lead.ownerUserId} followUpAt={lead.followUpAt} members={data.members} disabled={!canEdit} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Contacts" description="Only details the business published, or that a source provided." />
            <CardBody>
              {data.contacts.length === 0 ? (
                <p className="text-sm text-muted">{suppressed ? "Contact data was suppressed on request." : "No public contact details found yet."}</p>
              ) : (
                <ul className="space-y-3">
                  {data.contacts.map((c) => (
                    <li key={c.id} className="text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs uppercase text-subtle">{c.type.replace("_", " ")}</span>
                        {c.type === "email" ? <VerificationBadge status={c.verificationStatus} /> : null}
                      </div>
                      {c.type === "email" ? (
                        <a href={`mailto:${c.value}`} className="break-all text-accent hover:underline">
                          {c.value}
                        </a>
                      ) : c.type === "phone" ? (
                        <a href={`tel:${c.normalizedValue}`} className="text-accent hover:underline">
                          {c.value}
                        </a>
                      ) : (
                        <a href={c.value} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent hover:underline">
                          {c.value}
                        </a>
                      )}
                      {c.role ? <p className="text-xs text-muted">Role: {c.role}</p> : null}
                      <div>
                        <SourceLink providerId={c.providerId} url={c.sourceUrl} date={c.createdAt} />
                      </div>
                      {c.verificationDetail ? <p className="text-xs text-subtle">{c.verificationDetail}</p> : null}
                      {c.verifiedAt ? <p className="text-xs text-subtle">Last checked {fmtDate(c.verifiedAt, true)}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
              {isAdmin && !suppressed ? (
                <div className="mt-4 border-t border-border pt-3">
                  <ConfirmDialog
                    trigger={
                      <Button size="sm" variant="ghost" className="text-danger">
                        <ShieldOff /> Suppress contact data
                      </Button>
                    }
                    title="Suppress this business's contact data?"
                    description="Use for opt-out or erasure requests. All contact details are deleted for every workspace and future collection for this business is blocked."
                    confirmLabel="Suppress"
                    action={suppressAction}
                    hidden={{ leadId: lead.id }}
                  />
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Follow-up tasks (${data.tasks.filter((t) => !t.completedAt).length} open)`} />
            <CardBody className="space-y-3">
              {canEdit ? <TaskForm action={createTaskAction} leadId={lead.id} members={data.members} /> : null}
              <ul className="space-y-2">
                {data.tasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 text-sm">
                    <form action={completeTaskAction}>
                      <input type="hidden" name="leadId" value={lead.id} />
                      <input type="hidden" name="taskId" value={t.id} />
                      <input type="hidden" name="done" value={t.completedAt ? "0" : "1"} />
                      <button type="submit" disabled={!canEdit} aria-label={t.completedAt ? `Reopen ${t.title}` : `Complete ${t.title}`} className={`mt-0.5 flex size-4 items-center justify-center rounded border ${t.completedAt ? "border-accent bg-accent text-white" : "border-border-strong"}`}>
                        {t.completedAt ? <Check className="size-3" /> : null}
                      </button>
                    </form>
                    <div className="min-w-0">
                      <p className={t.completedAt ? "text-muted line-through" : ""}>{t.title}</p>
                      <p className={`text-xs ${!t.completedAt && t.dueAt && t.dueAt < new Date() ? "text-danger" : "text-subtle"}`}>
                        {t.dueAt ? `Due ${fmtDate(t.dueAt)}` : "No due date"}
                        {t.assigneeId ? ` · ${data.members.find((m) => m.id === t.assigneeId)?.name ?? ""}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Tags & lists" />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {data.leadTags.length === 0 ? <span className="text-sm text-muted">No tags.</span> : null}
                {data.leadTags.map((t) => (
                  <form key={t.id} action={tagLeadAction} className="inline-flex">
                    <input type="hidden" name="leadId" value={lead.id} />
                    <input type="hidden" name="tag" value={t.name} />
                    <input type="hidden" name="remove" value="1" />
                    <Badge tone="accent">
                      {t.name}
                      {canEdit ? (
                        <button type="submit" aria-label={`Remove tag ${t.name}`} className="hover:text-fg">
                          <X className="size-3" />
                        </button>
                      ) : null}
                    </Badge>
                  </form>
                ))}
              </div>
              {canEdit ? (
                <form action={tagLeadAction} className="flex gap-2">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <Input name="tag" placeholder="Add tag" aria-label="Add tag" list="tag-options" required maxLength={40} className="h-8" />
                  <datalist id="tag-options">
                    {data.allTags.map((t) => (
                      <option key={t.id} value={t.name} />
                    ))}
                  </datalist>
                  <Button size="sm" type="submit">
                    Add
                  </Button>
                </form>
              ) : null}
              <div className="border-t border-border pt-3">
                <p className="mb-1.5 text-xs font-medium text-muted">Lists</p>
                <ul className="space-y-1">
                  {data.lists
                    .filter((l) => data.listItems.some((i) => i.listId === l.id))
                    .map((l) => (
                      <li key={l.id} className="flex items-center justify-between text-sm">
                        {l.name}
                        {canEdit ? (
                          <form action={listLeadAction}>
                            <input type="hidden" name="leadId" value={lead.id} />
                            <input type="hidden" name="listId" value={l.id} />
                            <input type="hidden" name="remove" value="1" />
                            <button type="submit" className="text-xs text-muted hover:text-danger">
                              Remove
                            </button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                </ul>
                {canEdit && data.lists.some((l) => !data.listItems.some((i) => i.listId === l.id)) ? (
                  <form action={listLeadAction} className="mt-2 flex gap-2">
                    <input type="hidden" name="leadId" value={lead.id} />
                    <Select name="listId" aria-label="Add to list" className="h-8" required>
                      {data.lists
                        .filter((l) => !data.listItems.some((i) => i.listId === l.id))
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </Select>
                    <Button size="sm" type="submit">
                      Add
                    </Button>
                  </form>
                ) : data.lists.length === 0 ? (
                  <p className="text-xs text-muted">Create lists from the Leads page bulk actions or Saved searches.</p>
                ) : null}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Discovery history & sources" />
            <CardBody className="space-y-2 text-sm">
              <p>
                <span className="text-muted">First discovered (any workspace):</span> {fmtDate(b.firstDiscoveredAt, true)}
              </p>
              <p>
                <span className="text-muted">Saved to this workspace:</span> {fmtDate(lead.createdAt, true)}
              </p>
              <p>
                <span className="text-muted">Last verified:</span> {fmtDate(b.lastVerifiedAt, true)}
              </p>
              {b.sourcePublishedAt ? (
                <p>
                  <span className="text-muted">Source record last updated:</span> {fmtDate(b.sourcePublishedAt)}
                </p>
              ) : null}
              <div className="border-t border-border pt-2">
                <p className="mb-1 text-xs font-medium text-muted">Supporting sources</p>
                <ul className="space-y-1">
                  {providers.map((p) => {
                    const o = data.observations.filter((x) => x.providerId === p);
                    const url = o.find((x) => x.sourceUrl && /^https?:/.test(x.sourceUrl))?.sourceUrl;
                    return (
                      <li key={p}>
                        <SourceLink providerId={p} url={url} date={o[0]?.observedAt} label={`${o.length} observation${o.length > 1 ? "s" : ""}`} />
                      </li>
                    );
                  })}
                </ul>
              </div>
              {data.analyses.length > 1 ? <p className="text-xs text-subtle">{data.analyses.length} website analyses on record.</p> : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
