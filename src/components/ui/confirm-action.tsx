"use client";
import { useActionState, useEffect, useState } from "react";
import type { ActionState } from "@/lib/action-types";
import { Dialog } from "./dialog";
import { Button, type ButtonProps } from "./button";
import { FormMessage, SubmitButton } from "./form";

/** Destructive server action behind a confirmation dialog, with inline error feedback. */
export function ConfirmAction({
  action,
  label,
  title,
  description,
  confirmLabel = "Confirm",
  hidden = {},
  children,
  triggerVariant = "ghost",
  triggerSize = "sm",
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  label: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  hidden?: Record<string, string>;
  children?: React.ReactNode;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
}) {
  const [open, setOpen] = useState(false);
  const [state, act] = useActionState(action, null);
  useEffect(() => {
    if (state?.message && !state.error) setOpen(false);
  }, [state]);
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        trigger={
          <Button type="button" variant={triggerVariant} size={triggerSize}>
            {label}
          </Button>
        }
      >
        <form action={act} className="space-y-4">
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {children}
          <FormMessage state={state?.error ? state : null} />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton variant="danger" pendingText="Working…">
              {confirmLabel}
            </SubmitButton>
          </div>
        </form>
      </Dialog>
      {state?.message && !open ? <span className="sr-only" role="status">{state.message}</span> : null}
    </>
  );
}
