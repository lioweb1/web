import Link from "next/link";
import { CheckCircle2, Globe2, Radar, ScanSearch, BellRing, ShieldCheck, Sparkles } from "lucide-react";
import { getAuth } from "@/lib/auth/session";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: Radar, title: "Discovery from authorized sources", body: "Local businesses from OpenStreetMap, new UK companies from Companies House, newly observed domains from Certificate Transparency, launches from Hacker News and the RSS feeds you choose." },
  { icon: ScanSearch, title: "Website intelligence", body: "Detects WordPress, Webflow, Shopify, Wix and more, then measures SSL, mobile readiness, broken links and metadata — keeping measured issues separate from heuristics." },
  { icon: Sparkles, title: "Explainable scoring", body: "Every 0–100 score is a sum of ten factors, each with its evidence. Missing information is listed, never guessed. Scores qualify leads — they don’t predict purchases." },
  { icon: BellRing, title: "Monitoring & alerts", body: "Scheduled rules enrich, score and save new matches, then notify you in-app, in the browser, by email or webhook — on the schedule each source actually supports." },
  { icon: Globe2, title: "Any market, Premium Markets by default", body: "Target any country, region or city. New workspaces start with 18 Premium Markets — a starting point you can change, not a signal of intent." },
  { icon: ShieldCheck, title: "Privacy by design", body: "Workspace data is isolated with database row-level security. No scraping of social networks, no invented contacts, and built-in export, deletion and opt-out handling." },
];

export default async function Home() {
  const signedIn = !!(await getAuth());
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Logo />
          <nav className="flex items-center gap-2">
            {signedIn ? (
              <Button asChild variant="primary">
                <Link href="/app/dashboard">Go to app</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button asChild variant="primary">
                  <Link href="/register">Start free</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-20 sm:pt-28">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
            <span className="size-1.5 rounded-full bg-success" /> Free, authorized data sources only
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-fg sm:text-5xl">Find businesses that need a better website — with the evidence to prove it.</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">
            LeadOrbit AI discovers new and under-served businesses across your target markets, analyzes their websites, finds the contact details they publish, and explains every lead score. Built for web agencies, freelancers and B2B teams.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href={signedIn ? "/app/dashboard" : "/register"}>{signedIn ? "Open dashboard" : "Create a free account"}</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/data-sources">See the data sources</Link>
            </Button>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            {["No credit card", "No social media scraping", "Self-hostable"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-success" /> {t}
              </li>
            ))}
          </ul>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto grid max-w-6xl gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-surface p-6">
                <f.icon className="size-5 text-accent" aria-hidden />
                <h2 className="mt-3 text-sm font-semibold text-fg">{f.title}</h2>
                <p className="mt-1.5 text-sm text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">An example opportunity report</h2>
              <p className="mt-2 text-muted">What a lead looks like: an observation, the evidence behind it, and an honest confidence level.</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">Illustrative example</p>
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="text-muted">Opportunity</dt>
                  <dd className="font-medium">Potential WordPress redesign</dd>
                </div>
                <div>
                  <dt className="text-muted">Evidence</dt>
                  <dd>No mobile viewport tag · WordPress 5.2 · 3 of 12 sampled links broken</dd>
                </div>
                <div>
                  <dt className="text-muted">Suggested service</dt>
                  <dd>Website optimization and responsive redesign</dd>
                </div>
                <div>
                  <dt className="text-muted">Confidence</dt>
                  <dd>Medium — technical signals only, not proof of intent to buy</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} LeadOrbit AI</p>
          <nav className="flex gap-4">
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
      </footer>
    </div>
  );
}
