import Link from "next/link";
import { ArrowRight, Check, Clock, FileSearch, FileWarning, Gauge, Lock, Receipt, Scale, Stethoscope, Timer, Quote } from "lucide-react";
import { Logo } from "@/components/logo";
import { RoiCalculator } from "@/components/roi-calculator";

const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL || "sales@example.com";

const features = [
  {
    icon: FileSearch,
    title: "Missing-records detector",
    body: "Finds every MRI, referral, EMG or prior provider the records mention but you don't have — and drafts the HIPAA records-request letter for each one.",
    tag: "Beyond the chronology",
  },
  {
    icon: Timer,
    title: "Defense-risk radar",
    body: "Flags delay to first care, treatment gaps, pre-existing conditions and pain-score rebounds before opposing counsel does, with the page that proves it.",
    tag: "Beyond the chronology",
  },
  {
    icon: Receipt,
    title: "Medical specials reconciliation",
    body: "Totals billed vs. paid per provider, catches duplicate line items, charges with no treatment note, and visits that were never billed.",
    tag: "Beyond the chronology",
  },
  {
    icon: Quote,
    title: "Every fact cited to a page",
    body: "Each chronology entry links to its source file and page, with a verbatim quote. Click to open the exact page.",
  },
  {
    icon: Gauge,
    title: "Documentation strength score",
    body: "A 0–100 score with every deduction explained, so you know whether a case is ready for a demand or needs more records first.",
  },
  {
    icon: Lock,
    title: "Zero retention",
    body: "Records are processed in memory and never stored on our servers. Reports are built in your browser. Self-host on your own cloud for full control.",
  },
];

const steps = [
  { n: "1", title: "Drop in the records", body: "Upload any number of PDFs — ER, imaging, PT, billing ledgers, scanned or digital. 5,000+ pages per case." },
  { n: "2", title: "AI reads every page", body: "Each page is read the way a legal nurse consultant would: encounters, diagnoses, ICD-10/CPT, findings, bills, referrals." },
  { n: "3", title: "Verify and export", body: "Review the cited chronology, gaps and red flags, then download an attorney-ready Word report, CSVs and request letters." },
];

const plans = [
  {
    name: "Per case",
    price: "$149",
    unit: "per case up to 1,000 pages (+1 credit per extra 1,000)",
    body: "For solo attorneys and small firms.",
    items: ["Full chronology + citations", "Gap & red-flag analysis", "Missing-records letters", "Word + CSV export", "Packs of 5 or 20 cases save up to 16%"],
    cta: "Start free", href: "/signup",
  },
  {
    name: "Firm",
    price: "$1,490",
    unit: "per month, 25 cases included",
    body: "For PI and workers' comp firms with steady volume.",
    items: ["Everything in Per case", "Firm letterhead on letters", "Up to 10 users", "Priority processing", "Onboarding call"],
    cta: "Start free", href: "/signup",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "From $60k",
    unit: "per year",
    body: "Insurers, TPAs, IME vendors and large firms.",
    items: ["Unlimited volume", "Private deployment in your cloud", "BAA & security review", "Custom report templates", "API & case-management integration"],
    cta: "Contact sales", href: `mailto:${SALES_EMAIL}?subject=MedChrono%20Enterprise`,
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Logo />
          <nav className="hidden gap-6 text-sm text-muted md:flex">
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#roi" className="hover:text-ink">ROI</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
            <a href="#security" className="hover:text-ink">Security</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-ink">Sign in</Link>
            <Link href="/signup" className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-ink">Start free</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 md:pt-24">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal/30 bg-teal-soft px-3 py-1 text-xs font-medium text-teal">
          <Scale className="h-3.5 w-3.5" /> For personal injury, workers&apos; comp, med-mal & insurance claims
        </div>
        <h1 className="max-w-4xl font-serif text-4xl font-bold leading-tight tracking-tight md:text-6xl">
          A 10-day medical record review, <span className="text-teal">done in an hour.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">
          MedChrono AI turns thousands of pages of medical records into a page-cited chronology — then goes further: it finds the records you&apos;re missing,
          the gaps the defense will attack, and the billing errors that shrink your damages.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/demo" className="inline-flex items-center gap-2 rounded-lg bg-teal px-5 py-3 font-medium text-white hover:brightness-110">
            See a live demo case <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/signup" className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-5 py-3 font-medium hover:border-navy">
            First case free
          </Link>
        </div>
        <dl className="mt-14 grid max-w-3xl grid-cols-2 gap-6 md:grid-cols-4">
          {[
            ["~50", "pages/hour a human reviewer reads"],
            ["5,000+", "pages per case supported"],
            ["100%", "of entries cited to a page"],
            ["0", "records stored on our servers"],
          ].map(([k, v]) => (
            <div key={v}>
              <dt className="font-serif text-3xl font-bold text-navy">{k}</dt>
              <dd className="text-sm text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-y border-line bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 md:grid-cols-3">
          {[
            { icon: Clock, t: "Reviews take 1–2 weeks", b: "A paralegal or nurse reads every page by hand before a demand letter can go out." },
            { icon: FileWarning, t: "Missing records sink cases", b: "An MRI report nobody requested or a prior chiropractor surfaces in deposition." },
            { icon: Stethoscope, t: "Nurse consultants are expensive", b: "$75–$150 per hour, and they're booked weeks out when you need them most." },
          ].map(({ icon: I, t, b }) => (
            <div key={t} className="flex gap-4">
              <I className="mt-1 h-6 w-6 shrink-0 text-danger" />
              <div>
                <h3 className="font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-muted">{b}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="font-serif text-3xl font-bold md:text-4xl">More than a summary. A case strategy.</h2>
        <p className="mt-3 max-w-2xl text-muted">Other tools stop at the chronology. MedChrono tells you what to do next.</p>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {features.map(({ icon: I, title, body, tag }) => (
            <div key={title} className="rounded-2xl border border-line bg-white p-6">
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-teal-soft text-teal">
                  <I className="h-5 w-5" />
                </span>
                {tag && <span className="rounded-full bg-navy/5 px-2 py-0.5 text-[11px] font-medium text-navy">{tag}</span>}
              </div>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-navy text-white">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="font-serif text-3xl font-bold">How it works</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n}>
                <div className="font-serif text-5xl font-bold text-[#7fe0d6]">{s.n}</div>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-white/75">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="roi" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="font-serif text-3xl font-bold md:text-4xl">What it&apos;s worth to your firm</h2>
        <p className="mt-3 mb-8 max-w-2xl text-muted">Move the sliders to match your caseload.</p>
        <RoiCalculator />
      </section>

      <section id="pricing" className="border-t border-line bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="font-serif text-3xl font-bold md:text-4xl">Simple pricing</h2>
          <p className="mt-3 text-muted">Your first case (up to 300 pages) is free. Cheaper than one hour of a nurse consultant per case.</p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {plans.map((p) => (
              <div key={p.name} className={`flex flex-col rounded-2xl border p-6 ${p.featured ? "border-teal shadow-lg ring-1 ring-teal" : "border-line"}`}>
                <div className="text-sm font-semibold text-teal">{p.name}</div>
                <div className="mt-2 font-serif text-4xl font-bold">{p.price}</div>
                <div className="text-sm text-muted">{p.unit}</div>
                <p className="mt-3 text-sm">{p.body}</p>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {p.items.map((i) => (
                    <li key={i} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal" /> {i}
                    </li>
                  ))}
                </ul>
                <Link href={p.href} className={`mt-6 rounded-lg px-4 py-2.5 text-center text-sm font-medium ${p.featured ? "bg-teal text-white" : "border border-line hover:border-navy"}`}>
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="security" className="mx-auto max-w-6xl px-4 py-20">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="font-serif text-3xl font-bold">Built for protected health information</h2>
            <p className="mt-3 text-muted">
              Medical records are PHI. MedChrono is designed so the least possible data ever leaves your control.
            </p>
          </div>
          <ul className="space-y-3 text-sm">
            {[
              "No database of records: files are processed in memory and discarded when the request ends.",
              "Reports, CSVs and letters are generated in your browser.",
              "Deploy in your own AWS / Azure / GCP account for enterprise — data never leaves your tenant.",
              "Designed for use under a Business Associate Agreement with your AI provider and host.",
              "Every output is cited so a human reviewer can verify it — AI assists, your team decides.",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-navy" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="rounded-2xl bg-teal px-8 py-12 text-center text-white">
          <h2 className="font-serif text-3xl font-bold">See your own case in an hour.</h2>
          <p className="mx-auto mt-2 max-w-xl text-white/85">Open the demo case, or upload a real record set and watch the chronology build.</p>
          <Link href="/demo" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 font-medium text-teal">
            Open the demo <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-line py-8 text-center text-xs text-muted">
        © {new Date().getFullYear()} MedChrono AI · AI-assisted review; all output must be verified by a qualified professional. Not medical or legal advice.
      </footer>
    </div>
  );
}
