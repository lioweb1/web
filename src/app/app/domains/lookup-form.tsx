"use client";
import { useActionState } from "react";
import { Input, Checkbox } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { lookupDomainAction } from "./actions";

export function DomainLookupForm({ disabled }: { disabled?: boolean }) {
  const [state, act] = useActionState(lookupDomainAction, null);
  return (
    <form action={act} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="domain" className="sr-only">
          Domain
        </label>
        <Input id="domain" name="domain" placeholder="example.com" required disabled={disabled} className="sm:max-w-sm" />
        <Checkbox name="analyze" label="Also analyze the website" defaultChecked />
        <SubmitButton disabled={disabled} pendingText="Looking up…">
          Look up
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
