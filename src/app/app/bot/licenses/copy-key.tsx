"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyKey({ value, full = false }: { value: string; full?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="font-mono text-xs">{full ? value : `${value.slice(0, 7)}…${value.slice(-4)}`}</code>
      <button
        type="button"
        className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
        aria-label="Copy license key"
        title="Copy license key"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}
