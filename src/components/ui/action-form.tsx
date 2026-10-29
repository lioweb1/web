"use client";
import { useActionState } from "react";
import { Copy } from "lucide-react";
import type { ActionState } from "@/lib/action-types";
import { FormMessage, SubmitButton } from "./form";
import { cn } from "./cn";

/**
 * Generic form bound to a server action with inline success/error feedback.
 * If the action returns data.secret it is displayed once with a copy button.
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  pendingText = "Saving…",
  submitVariant = "primary",
  className,
  inline = false,
  hideSubmit = false,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submitLabel?: string;
  pendingText?: string;
  submitVariant?: "primary" | "secondary" | "danger" | "ghost";
  className?: string;
  inline?: boolean;
  hideSubmit?: boolean;
}) {
  const [state, act] = useActionState(action, null);
  const secret = typeof state?.data?.secret === "string" ? state.data.secret : null;
  return (
    <form action={act} className={cn(inline ? "flex flex-wrap items-end gap-2" : "space-y-4", className)}>
      {children}
      {!hideSubmit ? (
        <div className={inline ? "" : "pt-1"}>
          <SubmitButton variant={submitVariant} size={inline ? "sm" : "md"} pendingText={pendingText}>
            {submitLabel}
          </SubmitButton>
        </div>
      ) : null}
      <div className={inline ? "w-full empty:hidden" : "empty:hidden"}>
        <FormMessage state={state} />
        {secret ? (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">{secret}</code>
            <button type="button" className="rounded p-1 text-muted hover:text-fg" aria-label="Copy secret" onClick={() => navigator.clipboard?.writeText(secret)}>
              <Copy className="size-4" />
            </button>
          </div>
        ) : null}
      </div>
    </form>
  );
}
