"use client";
import { useActionState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { CountrySelector } from "@/components/ui/country-selector";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { createLeadFromSignalAction } from "./actions";

export function CreateLeadFromSignal({ signalId, title }: { signalId: string; title: string }) {
  const [state, act] = useActionState(createLeadFromSignalAction, null);
  return (
    <Dialog trigger={<Button size="sm">Create lead</Button>} title="Create a lead from this signal" description="Identify the business behind the signal. Only enter details that are publicly stated.">
      <p className="mb-3 line-clamp-2 text-xs text-muted">“{title}”</p>
      <form action={act} className="space-y-3">
        <input type="hidden" name="signalId" value={signalId} />
        <Field label="Business name" htmlFor={`n-${signalId}`}>
          <Input id={`n-${signalId}`} name="name" required />
        </Field>
        <Field label="Website (optional)" htmlFor={`w-${signalId}`}>
          <Input id={`w-${signalId}`} name="website" placeholder="example.com" />
        </Field>
        <Field label="Country (optional)">
          <CountrySelector name="country" single allowAll={false} placeholder="Unknown" />
        </Field>
        <FormMessage state={state} />
        <div className="flex justify-end">
          <SubmitButton pendingText="Creating…">Create lead</SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}
