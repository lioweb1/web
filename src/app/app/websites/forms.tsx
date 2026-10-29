"use client";
import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { analyzeUrlAction, reanalyzeAction, saveAnalysisLeadAction } from "./actions";

export function AnalyzeForm({ disabled }: { disabled?: boolean }) {
  const [state, act] = useActionState(analyzeUrlAction, null);
  return (
    <form action={act} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="url" className="sr-only">
          Website address
        </label>
        <Input id="url" name="url" placeholder="example.com" required disabled={disabled} className="sm:max-w-md" />
        <SubmitButton disabled={disabled} pendingText="Analyzing… (up to a minute)">
          Analyze website
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function ReanalyzeButton({ businessId }: { businessId: string }) {
  const [state, act] = useActionState(reanalyzeAction, null);
  return (
    <form action={act}>
      <input type="hidden" name="businessId" value={businessId} />
      <SubmitButton variant="secondary" size="sm" pendingText="Analyzing…">
        Re-analyze
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function SaveLeadButton({ businessId }: { businessId: string }) {
  const [state, act] = useActionState(saveAnalysisLeadAction, null);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="businessId" value={businessId} />
      <SubmitButton size="sm" pendingText="Saving…">
        Save as lead
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
