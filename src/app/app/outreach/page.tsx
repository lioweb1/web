import Link from "next/link";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { PageHeader, Card, CardHeader, CardBody, KpiCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice, EmptyState } from "@/components/ui/states";
import { ActionForm } from "@/components/ui/action-form";
import { Input, Field } from "@/components/ui/input";
import { StatusBadge, fmtDate, fmtRelative } from "@/components/ui/misc";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { countryName } from "@/lib/countries";
import { outreachOverview, outreachSmtp, pickAiProvider, draftKindLabel } from "@/lib/services/outreach";
import { suppressEmailAction, unsuppressEmailAction } from "./actions";

export const metadata = { title: "Outreach" };

export default async function OutreachPage() {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const [o, ai, smtp] = await Promise.all([outreachOverview(ws), pickAiProvider(ws), outreachSmtp(ws)]);
  const now = Date.now();
  const overdue = o.followUps.filter((f) => f.followUpAt && f.followUpAt.getTime() < now);
  const sent = o.messages.filter((m) => m.m.status === "sent");
  const unsubscribed = o.messages.filter((m) => m.m.unsubscribedAt).length;
  const canEdit = hasRole(ctx, "member");

  return (
    <>
      <PageHeader
        title="Outreach"
        description="Follow-ups that are due, drafts waiting for you, emails sent from your account and the do-not-contact list. LinkedIn activity is always done by you in your own browser; LeadOrbit only prepares the text and keeps the log."
        actions={
          <Link href="/app/leads?status=new,reviewed,qualified&sort=score" className="text-sm text-accent hover:underline">
            Pick leads to contact →
          </Link>
        }
      />

      {!ai || !smtp ? (
        <Notice tone="warning" className="mb-6">
          {!ai ? (
            <>
              <strong>AI drafts are off.</strong> Add a free <Link href="/app/integrations#gemini" className="underline">Gemini</Link> or <Link href="/app/integrations#groq" className="underline">Groq</Link> API key.{" "}
            </>
          ) : null}
          {!smtp ? (
            <>
              <strong>Email sending is off.</strong> Set up <Link href="/app/integrations#outreach_email" className="underline">Outreach email</Link> with a Gmail app password or Resend (both free).
            </>
          ) : null}
        </Notice>
      ) : null}

      <section aria-label="Outreach metrics" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Follow-ups overdue" value={overdue.length} hint={`${o.followUps.length} due within 7 days`} href="#followups" />
        <KpiCard label="Drafts to review" value={o.drafts.length} hint="Not yet posted or sent" href="#drafts" />
        <KpiCard label="Emails sent today" value={smtp ? `${o.sentToday} / ${smtp.dailyLimit}` : o.sentToday} hint={smtp ? `Daily cap · from ${smtp.smtp.from}` : "No email account configured"} href="#sent" />
        <KpiCard label="Unsubscribed" value={unsubscribed} hint={`${o.suppressions.length} suppressed addresses in total`} href="#suppressions" />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card id="followups">
          <CardHeader title="Follow-ups due" description="Set when you mark a draft as sent, send an email, or edit a lead's follow-up date. Reminders also arrive as notifications." />
          {o.followUps.length ? (
            <ul className="divide-y divide-border">
              {o.followUps.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/app/leads/${f.id}#outreach`} className="block truncate text-sm font-medium hover:underline">
                      {f.name}
                    </Link>
                    <p className="text-xs text-muted">{[f.city, f.countryCode ? countryName(f.countryCode) : null].filter(Boolean).join(", ")}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={f.status} />
                    <span className={`text-xs ${f.followUpAt && f.followUpAt.getTime() < now ? "text-danger" : "text-muted"}`}>{f.followUpAt ? fmtRelative(f.followUpAt) : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing due" description="When you log outreach with a follow-up, it shows up here." />
          )}
        </Card>

        <Card id="drafts">
          <CardHeader title="Drafts waiting" description="Open the lead to copy, edit, post or send." />
          {o.drafts.length ? (
            <ul className="divide-y divide-border">
              {o.drafts.map(({ d, name }) => (
                <li key={d.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/app/leads/${d.leadId}#outreach`} className="truncate text-sm font-medium hover:underline">
                      {name}
                    </Link>
                    <Badge tone={d.kind.startsWith("linkedin") ? "info" : "accent"}>{draftKindLabel(d.kind)}</Badge>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted">{d.subject ? `${d.subject} — ` : ""}{d.body || <em>empty</em>}</p>
                  <p className="text-[11px] text-subtle">{d.providerId === "manual" ? "by hand" : d.providerId} · {fmtRelative(d.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No drafts" description="Generate one from any lead's Outreach section." />
          )}
        </Card>

        <Card id="sent" className="lg:col-span-2">
          <CardHeader title={`Emails sent from LeadOrbit (${sent.length})`} description="One-to-one emails over your own SMTP account. Each one carries an unsubscribe link and your postal address." />
          {o.messages.length ? (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Business</TH>
                    <TH>To</TH>
                    <TH>Subject</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <tbody>
                  {o.messages.map(({ m, name }) => (
                    <TR key={m.id}>
                      <TD className="whitespace-nowrap text-muted">{fmtDate(m.sentAt, true)}</TD>
                      <TD>
                        <Link href={`/app/leads/${m.leadId}#outreach`} className="hover:underline">
                          {name}
                        </Link>
                      </TD>
                      <TD className="text-muted">{m.toEmail}</TD>
                      <TD className="max-w-xs truncate">{m.subject}</TD>
                      <TD>
                        {m.status === "sent" ? <Badge tone="success">Sent</Badge> : <Badge tone="danger" title={m.error ?? undefined}>Failed</Badge>}
                        {m.unsubscribedAt ? <Badge tone="warning" className="ml-1">Unsubscribed</Badge> : null}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <EmptyState title="No emails sent yet" description="Send your first one from a lead that has a published business email." />
          )}
        </Card>

        <Card id="suppressions" className="lg:col-span-2">
          <CardHeader title="Do-not-contact list" description="Unsubscribes land here automatically. Add addresses by hand when someone asks you to stop by reply or phone." />
          <CardBody className="space-y-4">
            {canEdit ? (
              <ActionForm action={suppressEmailAction} inline submitLabel="Add to list" pendingText="Adding…">
                <Field label="Email" htmlFor="sup-email" className="w-72">
                  <Input id="sup-email" name="email" type="email" required placeholder="name@business.example" />
                </Field>
                <Field label="Note (optional)" htmlFor="sup-note" className="w-72">
                  <Input id="sup-note" name="note" maxLength={200} placeholder="Asked by phone on 3 Nov" />
                </Field>
              </ActionForm>
            ) : null}
            {o.suppressions.length ? (
              <ul className="divide-y divide-border text-sm">
                {o.suppressions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <span className="font-medium">{s.email}</span> <Badge tone="outline">{s.reason}</Badge>
                      {s.note ? <span className="ml-2 text-xs text-muted">{s.note}</span> : null}
                      <span className="ml-2 text-xs text-subtle">{fmtDate(s.createdAt)}</span>
                    </div>
                    {hasRole(ctx, "admin") && s.reason === "manual" ? (
                      <ActionForm action={unsuppressEmailAction} inline submitLabel="Remove" submitVariant="ghost" hideSubmit={false}>
                        <input type="hidden" name="email" value={s.email} />
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Empty. Addresses that unsubscribe are added automatically and can never be emailed again from this workspace.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
