"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { TermsCheckbox } from "./json-form";

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      // Only same-site relative paths, so ?next= can't send people elsewhere.
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/workspace";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const input = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2.5 outline-none focus:border-navy";
  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === "signup" && (
        <>
          <label className="block text-sm">
            <span className="text-muted">Your name</span>
            <input name="name" required autoComplete="name" className={input} />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Law firm / company</span>
            <input name="firm" required autoComplete="organization" className={input} />
          </label>
        </>
      )}
      <label className="block text-sm">
        <span className="text-muted">Work email</span>
        <input name="email" type="email" required autoComplete="email" className={input} />
      </label>
      <label className="block text-sm">
        <span className="text-muted">Password{mode === "signup" ? " (10+ characters)" : ""}</span>
        <input name="password" type="password" required minLength={mode === "signup" ? 10 : undefined} autoComplete={mode === "signup" ? "new-password" : "current-password"} className={input} />
      </label>
      {mode === "signup" && <TermsCheckbox />}
      {mode === "login" && (
        <div className="-mt-2 text-right text-sm"><Link href="/forgot-password" className="text-teal">Forgot password?</Link></div>
      )}
      {error && <div className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</div>}
      <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 font-medium text-white disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {mode === "signup" ? "Create account — first case free" : "Sign in"}
      </button>
      <p className="text-center text-sm text-muted">
        {mode === "signup" ? (
          <>Already have an account? <Link className="text-teal" href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>
        ) : (
          <>New to MedChrono? <Link className="text-teal" href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link></>
        )}
      </p>
    </form>
  );
}
