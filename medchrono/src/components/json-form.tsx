"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

/** Posts the form's fields as JSON; on success either redirects or shows a message. */
export function JsonForm({
  action,
  extra,
  submit,
  redirectTo,
  successMessage,
  children,
}: {
  action: string;
  extra?: Record<string, string>;
  submit: string;
  redirectTo?: string;
  successMessage?: string;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { ...extra };
    for (const [k, v] of fd) body[k] = v;
    try {
      const res = await fetch(action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      if (redirectTo) window.location.href = redirectTo;
      else {
        setDone(true);
        setBusy(false);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (done && successMessage) return <div className="rounded-lg bg-teal-soft p-4 text-sm text-teal">{successMessage}</div>;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {children}
      {error && <div className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</div>}
      <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 font-medium text-white disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {submit}
      </button>
    </form>
  );
}

export const inputClass = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2.5 outline-none focus:border-navy";

export function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-sm">
      <span className="text-muted">{label}</span>
      <input {...props} className={inputClass} />
    </label>
  );
}

export function TermsCheckbox() {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name="accept_terms" required className="mt-1 accent-teal" />
      <span className="text-muted">
        I agree to the <a href="/terms" target="_blank" className="text-teal underline">Terms of Service</a> and{" "}
        <a href="/privacy" target="_blank" className="text-teal underline">Privacy Policy</a>, including the Business Associate terms.
      </span>
    </label>
  );
}
