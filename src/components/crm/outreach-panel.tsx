"use client";
import { useActionState, useState } from "react";
import { Copy, Check, Mail, Sparkles, Trash2, ExternalLink, PenLine, Building2 } from "lucide-react";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/states";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/dialog";
import type { ActionState } from "@/lib/action-types";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Simple = (fd: FormData) => Promise<void>;

/** Dates arrive pre-formatted: this client component must not import server-leaning modules (the shared date helpers pull in the provider registry). */
export type DraftView = { id: string; kind: string; subject: string | null; body: string; providerId: string; model: string | null; createdAgo: string; usedAt: string | null };
export type SentView = { id: string; toEmail: string; subject: string; status: string; sentAgo: string; unsubscribedAt: string | null; error: string | null };

const KINDS: [string, string][] = [
  ["linkedin_comment", "LinkedIn comment"],
  ["linkedin_message", "LinkedIn message"],
  ["email", "Cold email"],
  ["follow_up_email", "Follow-up email"],
];
const kindLabel = (k: string) => KINDS.find(([key]) => key === k)?.[1] ?? k;
/** Lower-case for mid-sentence use while keeping the brand spelling. */
const kindNoun = (k: string) => kindLabel(k).replace(/^(Cold|Follow-up)/, (m) => m.toLowerCase());
const isEmailKind = (k: string) => k === "email" || k === "follow_up_email";

export function OutreachPanel(props: {
  leadId: string;
  businessName: string;
  canEdit: boolean;
  suppressed: boolean;
  aiProvider: string | null;
  smtp: { ready: boolean; source: "workspace" | "env" | null; from: string | null; dailyLimit: number; sentToday: number; postalAddressMissing: boolean };
  emails: string[];
  linkedinUrl: string | null;
  defaultLanguage: string;
  drafts: DraftView[];
  sent: SentView[];
  actions: { generate: Act; newManual: Simple; save: Act; markUsed: Act; send: Act; remove: Simple };
}) {
  const { leadId, canEdit, suppressed } = props;
  const linkedinSearch = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(props.businessName)}`;
  return (
    <div className="space-y-4">
      <Notice>
        <span className="font-medium">How this works.</span> Generate a draft from the evidence on this lead, read and edit it, then <em>you</em> post the comment or send the message on LinkedIn and click <em>Mark as posted</em> to log it and schedule a follow-up. Emails go out from your own email account to the business address they published, with an unsubscribe link. LeadOrbit never logs in to LinkedIn or posts, likes or messages on your behalf.
      </Notice>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {props.linkedinUrl ? (
          <Button asChild size="sm" variant="secondary">
            <a href={props.linkedinUrl} target="_blank" rel="noopener noreferrer nofollow">
              <Building2 /> Open their LinkedIn page <ExternalLink className="size-3" />
            </a>
          </Button>
        ) : (
          <Button asChild size="sm" variant="secondary" title="No LinkedIn page was found on their website or listing; this opens a LinkedIn company search in a new tab.">
            <a href={linkedinSearch} target="_blank" rel="noopener noreferrer nofollow">
              <Building2 /> Find on LinkedIn <ExternalLink className="size-3" />
            </a>
          </Button>
        )}
        <span className="text-muted">
          AI: {props.aiProvider ? <Badge tone="success">{props.aiProvider === "gemini" ? "Gemini" : "Groq"} connected</Badge> : <Badge tone="warning">not configured</Badge>}
        </span>
        <span className="text-muted">
          Email: {props.smtp.ready ? <Badge tone="success">{props.smtp.source === "workspace" ? "your SMTP account" : "server SMTP"} · {props.smtp.sentToday}/{props.smtp.dailyLimit} today</Badge> : <Badge tone="warning">not configured</Badge>}
        </span>
        {!props.aiProvider || !props.smtp.ready ? (
          <a href="/app/integrations#gemini" className="text-accent hover:underline">
            Set up free Gemini / Groq / SMTP →
          </a>
        ) : null}
      </div>

      {suppressed ? <Notice tone="warning">This business asked not to be contacted. Outreach is disabled.</Notice> : null}

      {canEdit && !suppressed ? <GenerateForm leadId={leadId} action={props.actions.generate} newManual={props.actions.newManual} aiReady={!!props.aiProvider} defaultLanguage={props.defaultLanguage} /> : null}

      {props.drafts.length ? (
        <ul className="space-y-3">
          {props.drafts.map((d) => (
            <DraftCard key={d.id} draft={d} leadId={leadId} canEdit={canEdit && !suppressed} emails={props.emails} smtp={props.smtp} actions={props.actions} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No drafts yet.</p>
      )}

      {props.sent.length ? (
        <div className="border-t border-border pt-3">
          <p className="mb-1.5 text-xs font-medium text-muted">Emails sent from LeadOrbit</p>
          <ul className="space-y-1 text-sm">
            {props.sent.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <Mail className="size-3.5 text-muted" />
                <span className="font-medium">{m.subject}</span>
                <span className="text-xs text-muted">to {m.toEmail}</span>
                {m.status === "sent" ? <Badge tone="success">Sent</Badge> : <Badge tone="danger" title={m.error ?? undefined}>Failed</Badge>}
                {m.unsubscribedAt ? <Badge tone="warning">Unsubscribed</Badge> : null}
                <span className="text-xs text-subtle">{m.sentAgo}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function GenerateForm({ leadId, action, newManual, aiReady, defaultLanguage }: { leadId: string; action: Act; newManual: Simple; aiReady: boolean; defaultLanguage: string }) {
  const [state, act] = useActionState(action, null);
  const [kind, setKind] = useState("linkedin_message");
  return (
    <div className="rounded-md border border-border p-3">
      <form action={act} className="space-y-3">
        <input type="hidden" name="leadId" value={leadId} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="What to write" htmlFor="draft-kind">
            <Select id="draft-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tone" htmlFor="draft-tone">
            <Select id="draft-tone" name="tone" defaultValue="friendly">
              <option value="friendly">Friendly</option>
              <option value="professional">Professional</option>
              <option value="concise">Concise</option>
              <option value="casual">Casual</option>
            </Select>
          </Field>
          <Field label="Language" htmlFor="draft-lang">
            <Input id="draft-lang" name="language" defaultValue={defaultLanguage} maxLength={40} placeholder="English" />
          </Field>
        </div>
        <Field
          label={kind === "linkedin_comment" ? "Paste the LinkedIn post you want to comment on" : "Extra context (optional)"}
          htmlFor="draft-context"
          hint={kind === "linkedin_comment" ? "The comment will respond to this post. Only paste public post text." : "e.g. you met them at an event, or something specific you noticed. The AI uses only the facts on this lead plus this note."}
        >
          <Textarea id="draft-context" name="context" maxLength={2000} className="min-h-16" required={kind === "linkedin_comment"} />
        </Field>
        <FormMessage state={state} />
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton size="sm" pendingText="Writing…" disabled={!aiReady} title={aiReady ? undefined : "Add a free Gemini or Groq API key under Data sources"}>
            <Sparkles /> Generate draft
          </SubmitButton>
          <span className="text-xs text-muted">or</span>
        </div>
      </form>
      <form action={newManual} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="leadId" value={leadId} />
        <input type="hidden" name="kind" value={kind} />
        <Button size="sm" variant="ghost" type="submit">
          <PenLine /> Write a {kindNoun(kind)} by hand
        </Button>
      </form>
    </div>
  );
}

function DraftCard({ draft, leadId, canEdit, emails, smtp, actions }: { draft: DraftView; leadId: string; canEdit: boolean; emails: string[]; smtp: { ready: boolean; postalAddressMissing: boolean }; actions: { save: Act; markUsed: Act; send: Act; remove: Simple } }) {
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body);
  const [copied, setCopied] = useState(false);
  const [saveState, save] = useActionState(actions.save, null);
  const [usedState, markUsed] = useActionState(actions.markUsed, null);
  const [sendState, send] = useActionState(actions.send, null);
  const dirty = subject !== (draft.subject ?? "") || body !== draft.body;
  const email = isEmailKind(draft.kind);
  const copy = async () => {
    const text = email && subject ? `Subject: ${subject}\n\n${body}` : body;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const hidden = (
    <>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="draftId" value={draft.id} />
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="body" value={body} />
    </>
  );
  return (
    <li className={`rounded-md border p-3 ${draft.usedAt ? "border-border bg-surface-2/40" : "border-border-strong"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={draft.kind.startsWith("linkedin") ? "info" : "accent"}>{kindLabel(draft.kind)}</Badge>
        <span className="text-muted">
          {draft.providerId === "manual" ? "Written by hand" : `Drafted by ${draft.providerId}${draft.model ? ` · ${draft.model}` : ""}`} · {draft.createdAgo}
        </span>
        {draft.usedAt ? <Badge tone="success">{email ? "Sent" : "Posted"}</Badge> : null}
        {draft.providerId !== "manual" && !draft.usedAt ? <span className="text-warning">Check every claim before sending — AI text can be wrong.</span> : null}
      </div>
      <fieldset disabled={!canEdit} className="space-y-2">
        {email ? <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" maxLength={200} /> : null}
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} aria-label="Draft text" className="min-h-28" maxLength={6000} />
        <p className="text-right text-[11px] text-subtle">{body.trim().split(/\s+/).filter(Boolean).length} words</p>
      </fieldset>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" type="button" onClick={copy}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
        {canEdit ? (
          <>
            <form action={save}>
              {hidden}
              <SubmitButton size="sm" variant="ghost" disabled={!dirty} pendingText="Saving…">
                Save edits
              </SubmitButton>
            </form>
            {!draft.usedAt ? (
              <form action={markUsed} className="flex flex-wrap items-center gap-2">
                {hidden}
                <Select name="followUpDays" aria-label="Follow-up reminder" className="h-8 w-44 text-xs" defaultValue="7">
                  <option value="0">No follow-up</option>
                  <option value="3">Follow up in 3 days</option>
                  <option value="5">Follow up in 5 days</option>
                  <option value="7">Follow up in 7 days</option>
                  <option value="14">Follow up in 14 days</option>
                </Select>
                <SubmitButton size="sm" variant="secondary" pendingText="Logging…">
                  <Check /> {email ? "Mark as sent manually" : draft.kind === "linkedin_comment" ? "Mark as posted" : "Mark as sent"}
                </SubmitButton>
              </form>
            ) : null}
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost" className="text-danger" aria-label="Delete draft">
                  <Trash2 />
                </Button>
              }
              title="Delete this draft?"
              description="The text is removed. Anything already logged in the timeline stays."
              confirmLabel="Delete"
              action={actions.remove}
              hidden={{ leadId, draftId: draft.id }}
            />
          </>
        ) : null}
      </div>
      <FormMessage state={saveState} />
      <FormMessage state={usedState} />
      {email && canEdit && !draft.usedAt ? (
        <form action={send} className="mt-3 space-y-2 rounded-md border border-border bg-surface p-3">
          {hidden}
          <p className="text-xs font-medium text-muted">Send by email from your account</p>
          {!smtp.ready ? (
            <p className="text-xs text-warning">
              Configure <a href="/app/integrations#outreach_email" className="underline">Outreach email</a> first (Gmail app password or Resend, both free).
            </p>
          ) : smtp.postalAddressMissing ? (
            <p className="text-xs text-warning">
              Add your postal address under <a href="/app/integrations#outreach_email" className="underline">Outreach email</a>; anti-spam law requires it.
            </p>
          ) : emails.length === 0 ? (
            <p className="text-xs text-muted">This business has not published an email address, so there is nothing to send to. Try LinkedIn or their contact form instead.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select name="to" aria-label="Recipient" className="h-8 w-64 text-xs">
                {emails.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </Select>
              <Select name="followUpDays" aria-label="Follow-up reminder" className="h-8 w-44 text-xs" defaultValue="7">
                <option value="0">No follow-up</option>
                <option value="3">Follow up in 3 days</option>
                <option value="5">Follow up in 5 days</option>
                <option value="7">Follow up in 7 days</option>
                <option value="14">Follow up in 14 days</option>
              </Select>
              <SubmitButton size="sm" variant="primary" pendingText="Sending…" disabled={!subject.trim() || !body.trim()}>
                <Mail /> Send email
              </SubmitButton>
            </div>
          )}
          <p className="text-[11px] text-subtle">Your signature, postal address and an unsubscribe link are appended automatically. Only addresses the business published are allowed.</p>
          <FormMessage state={sendState} />
        </form>
      ) : null}
    </li>
  );
}
