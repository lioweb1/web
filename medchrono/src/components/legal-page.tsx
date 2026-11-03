import Link from "next/link";
import { Logo } from "./logo";
import { LEGAL } from "@/lib/legal";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  const draft = LEGAL.company.startsWith("[");
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Logo />
          <nav className="flex gap-4 text-sm text-muted">
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12">
        {draft && (
          <div className="mb-8 rounded-xl border border-warn/40 bg-warn-soft p-4 text-sm text-warn">
            <b>Draft template.</b> Fill in the company details (NEXT_PUBLIC_LEGAL_* settings) and have a licensed U.S. attorney review this page before
            accepting customers.
          </div>
        )}
        <h1 className="font-serif text-4xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted">Effective {LEGAL.effective}</p>
        <div className="legal mt-8 space-y-4 text-[15px] leading-relaxed text-ink/90 [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mt-6 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1">
          {children}
        </div>
      </main>
      <footer className="border-t border-line py-8 text-center text-xs text-muted">
        {LEGAL.company} · {LEGAL.address} · <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
      </footer>
    </div>
  );
}
