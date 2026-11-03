"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { ProductId } from "@/lib/plans";

async function go(path: string, body?: object): Promise<string> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.url) throw new Error(j.error || "Could not start checkout.");
  return j.url;
}

export function BuyButton({ product, children, primary }: { product: ProductId; children: React.ReactNode; primary?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            window.location.href = await go("/api/billing/checkout", { product });
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
        className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60 ${primary ? "bg-teal text-white" : "border border-line bg-white hover:border-navy"}`}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {children}
      </button>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function PortalButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            window.location.href = await go("/api/billing/portal");
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium hover:border-navy"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Manage subscription & invoices
      </button>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
