"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { cn } from "./cn";

export function Dialog({ trigger, title, description, children, open, onOpenChange, wide }: { trigger?: React.ReactNode; title: string; description?: string; children: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; wide?: boolean }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <D.Trigger asChild>{trigger}</D.Trigger> : null}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[1px]" />
        <D.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-xl", wide ? "max-w-2xl" : "max-w-md")}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-base font-semibold text-fg">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X />
              </Button>
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/**
 * Confirmation dialog wrapping a server action form. The hidden inputs and action are
 * passed through so the destructive action only runs after explicit confirmation.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  action,
  hidden,
  danger = true,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  action: (fd: FormData) => void | Promise<void>;
  hidden?: Record<string, string | string[]>;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog trigger={trigger} title={title} description={description} open={open} onOpenChange={setOpen}>
      <form
        action={async (fd) => {
          await action(fd);
          setOpen(false);
        }}
        className="flex justify-end gap-2"
      >
        {Object.entries(hidden ?? {}).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x, i) => <input key={`${k}${i}`} type="hidden" name={k} value={x} />))}
        <D.Close asChild>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </D.Close>
        <Button type="submit" variant={danger ? "danger" : "primary"}>
          {confirmLabel}
        </Button>
      </form>
    </Dialog>
  );
}
