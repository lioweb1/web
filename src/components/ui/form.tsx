"use client";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import type { ActionState } from "@/lib/action-types";
import { ErrorState, Notice } from "./states";

export function SubmitButton({ children, pendingText, ...p }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending || p.disabled} aria-busy={pending} {...p}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) return <ErrorState title="Could not complete the request" description={state.error} />;
  if (state.message) return <Notice tone="success">{state.message}</Notice>;
  return null;
}
