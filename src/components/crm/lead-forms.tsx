"use client";
import { useActionState, useEffect, useRef } from "react";
import { Input, Select, Textarea, Field } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { LEAD_STATUSES, PRIORITIES } from "@/lib/lead-constants";
import type { ActionState } from "@/lib/action-types";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const dateValue = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export function LeadEditForm({ action, leadId, status, priority, ownerUserId, followUpAt, members, disabled }: { action: Act; leadId: string; status: string; priority: string; ownerUserId: string | null; followUpAt: Date | null; members: { id: string; name: string }[]; disabled: boolean }) {
  const [state, act] = useActionState(action, null);
  return (
    <form action={act} className="space-y-3">
      <input type="hidden" name="leadId" value={leadId} />
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={status}>
            {LEAD_STATUSES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="priority">
          <Select id="priority" name="priority" defaultValue={priority}>
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </Field>
        <Field label="Owner" htmlFor="ownerUserId">
          <Select id="ownerUserId" name="ownerUserId" defaultValue={ownerUserId ?? "none"}>
            <option value="none">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Follow-up date" htmlFor="followUpAt">
          <Input id="followUpAt" type="date" name="followUpAt" defaultValue={dateValue(followUpAt)} />
        </Field>
      </fieldset>
      <FormMessage state={state} />
      {!disabled ? <SubmitButton size="sm">Save changes</SubmitButton> : null}
    </form>
  );
}

function useResetOnSuccess(state: ActionState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export function NoteForm({ action, leadId }: { action: Act; leadId: string }) {
  const [state, act] = useActionState(action, null);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={act} className="space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <Textarea name="body" placeholder="Add a note…" aria-label="New note" required maxLength={10000} />
      {state?.error ? <FormMessage state={state} /> : null}
      <SubmitButton size="sm">Add note</SubmitButton>
    </form>
  );
}

export function CommunicationForm({ action, leadId }: { action: Act; leadId: string }) {
  const [state, act] = useActionState(action, null);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={act} className="space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="flex flex-wrap gap-2">
        <Select name="kind" aria-label="Interaction type" className="w-32">
          <option value="email">Email</option>
          <option value="call">Call</option>
          <option value="meeting">Meeting</option>
          <option value="message">Message</option>
        </Select>
        <Input type="datetime-local" name="occurredAt" aria-label="When (defaults to now)" className="w-52" />
      </div>
      <Textarea name="summary" placeholder="What happened? e.g. Sent intro email about mobile redesign" aria-label="Summary" required maxLength={2000} className="min-h-16" />
      {state?.error ? <FormMessage state={state} /> : null}
      <SubmitButton size="sm">Log interaction</SubmitButton>
    </form>
  );
}

export function TaskForm({ action, leadId, members }: { action: Act; leadId: string; members: { id: string; name: string }[] }) {
  const [state, act] = useActionState(action, null);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={act} className="space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <Input name="title" placeholder="Follow-up task, e.g. Call back on Tuesday" aria-label="Task" required maxLength={300} />
      <div className="flex flex-wrap gap-2">
        <Input type="date" name="dueAt" aria-label="Due date" className="w-40" />
        <Select name="assigneeId" aria-label="Assignee" className="w-44">
          <option value="none">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <SubmitButton size="sm">Add task</SubmitButton>
      </div>
      {state?.error ? <FormMessage state={state} /> : null}
    </form>
  );
}
