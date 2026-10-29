import Link from "next/link";
import { Logo } from "@/components/app/logo";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="flex gap-4 text-sm text-muted">
            <Link href="/privacy" className="hover:text-fg">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-fg">
              Terms
            </Link>
            <Link href="/data-sources" className="hover:text-fg">
              Data sources
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          <strong>Template.</strong> This document is a starting point written for a self-hosted LeadOrbit installation. Replace the bracketed placeholders and have it reviewed by a qualified lawyer for your jurisdiction before production use.
        </div>
        <article className="space-y-4 text-sm leading-relaxed text-fg/90 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-fg [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc">{children}</article>
      </main>
    </div>
  );
}
