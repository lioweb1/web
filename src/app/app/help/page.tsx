import Link from "next/link";
import { PageHeader, Card, CardBody } from "@/components/ui/card";
import { VerificationBadge } from "@/components/ui/misc";
import { PROVIDERS } from "@/lib/providers/registry";

export const metadata = { title: "Help & documentation" };

const SECTIONS = [
  ["getting-started", "Getting started"],
  ["data-sources", "Data sources & free keys"],
  ["scoring", "How lead scoring works"],
  ["email-verification", "Email verification statuses"],
  ["website-analysis", "Website analysis"],
  ["monitoring", "Monitoring & schedules"],
  ["notifications", "Notifications & email"],
  ["webhooks", "Webhooks & CRM"],
  ["privacy", "Privacy & opt-out requests"],
  ["shortcuts", "Keyboard shortcuts"],
] as const;

const FACTORS: [string, number, string][] = [
  ["Target country match", 10, "Country is in your default target market (or the rule’s countries). Unknown country scores 0."],
  ["Industry relevance", 10, "Industry matches your target industries. Neutral 5 points when you haven’t set any."],
  ["Business launch signals", 15, "Registry incorporation date, RDAP domain registration date, launch posts or new TLS certificates — the strongest dated evidence wins."],
  ["Website availability", 10, "No website listed, or the site is down — both are opportunities. An online site scores 2."],
  ["Website technical condition", 15, "Weighted sum of issues found by the analyzer; measured issues count double heuristic ones."],
  ["Public evidence of demand", 15, "Explicit public requests such as “looking for a web developer” or “redesigning our website”."],
  ["Technology compatibility", 5, "Built on a technology you work with (Settings → Workspace), greenfield, or a migration candidate."],
  ["Business contact availability", 10, "Email (more points the better its verification status), phone, contact page or social profile."],
  ["Recency of evidence", 5, "How recent the newest supporting evidence is."],
  ["Data source reliability", 5, "Official registries score highest; community and inferred sources lower."],
];

export default function HelpPage() {
  return (
    <>
      <PageHeader title="Help & documentation" description="How LeadOrbit finds, qualifies and organizes leads — and what it deliberately doesn’t do." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] [&>*]:min-w-0">
        <nav aria-label="Help sections" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="space-y-1 text-sm">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded px-2 py-1 text-muted hover:bg-surface-2 hover:text-fg">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="prose-sm space-y-6 text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-medium [&_li]:ml-4 [&_li]:list-disc [&_p]:text-fg/90">
          <Section id="getting-started" title="Getting started">
            <ol className="space-y-1">
              <li>
                Review your <Link className="text-accent hover:underline" href="/app/settings?tab=markets">target markets</Link>. New workspaces start with the Premium Markets preset (18 countries); change it any time.
              </li>
              <li>
                Open <Link className="text-accent hover:underline" href="/app/integrations">Data sources</Link> and run a connection test. Key-less sources work immediately.
              </li>
              <li>
                Run a search on <Link className="text-accent hover:underline" href="/app/discover">Discover</Link> — for example dentists in one city with no website listed on OpenStreetMap.
              </li>
              <li>
                Save the search as a <Link className="text-accent hover:underline" href="/app/monitoring">monitoring rule</Link> so new matches are enriched, scored and sent to you automatically.
              </li>
              <li>
                Make sure the background worker is running (<code className="font-mono text-xs">npm run worker</code>) — schedules, enrichment and notifications run there.
              </li>
            </ol>
          </Section>

          <Section id="data-sources" title="Data sources & free keys">
            <p>Every built-in source is free. Some need a free key:</p>
            <h3>UK Companies House (free key)</h3>
            <p>Register at developer.company-information.service.gov.uk, create an application, add a “REST” API key and paste it on the Data sources page. Limit: 600 requests per 5 minutes.</p>
            <h3>Google PageSpeed Insights (optional free key)</h3>
            <p>Works without a key at low volume. For more, create a Google Cloud project, enable “PageSpeed Insights API” and create an API key. PageSpeed is off by default because each test takes 10–30 seconds.</p>
            <h3>HubSpot free CRM (free token)</h3>
            <p>In HubSpot: Settings → Integrations → Private apps → create an app with the companies read/write scopes, then paste the access token.</p>
            <h3>RSS / Atom feeds</h3>
            <p>Add public feeds you’re allowed to read: press-release wires for your region, local business news, chamber-of-commerce news, startup blogs, or job boards that publish RSS. Items are classified as launches, website requests, redesigns, eCommerce or expansion news.</p>
            <h3>Coverage</h3>
            <ul>
              {PROVIDERS.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong> — {p.unavailableReason ? "not available (see Data sources for why and the alternatives)" : p.pricingNote}
                </li>
              ))}
            </ul>
            <p>LinkedIn and Facebook do not offer APIs that allow searching other companies’ posts or new pages, and scraping is against their terms. LeadOrbit never logs in to, scrapes or bypasses these platforms. Company page links are collected only when a business publishes them on its own website or map listing.</p>
          </Section>

          <Section id="scoring" title="How lead scoring works">
            <p>Each lead gets a 0–100 score made of ten factors. Every point carries the evidence that produced it; factors without evidence score 0 and appear under “missing information”. Scores are qualification categories, not purchase probabilities.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Factor</th>
                    <th className="py-1 pr-3 font-medium">Max</th>
                    <th className="py-1 font-medium">What earns points</th>
                  </tr>
                </thead>
                <tbody>
                  {FACTORS.map(([f, max, d]) => (
                    <tr key={f} className="border-t border-border">
                      <td className="py-1.5 pr-3">{f}</td>
                      <td className="tabular py-1.5 pr-3">{max}</td>
                      <td className="py-1.5 text-muted">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>Categories: 90–100 Excellent Match · 75–89 High Potential · 50–74 Moderate Potential · 25–49 Low Potential · 0–24 Weak Match. Confidence reflects how many factors have evidence.</p>
          </Section>

          <Section id="email-verification" title="Email verification statuses">
            <ul className="space-y-1.5">
              <li>
                <VerificationBadge status="verified_by_provider" /> — a dedicated email-verification provider confirmed the mailbox. No such provider is connected by default (they are paid), so you won’t normally see this.
              </li>
              <li>
                <VerificationBadge status="domain_valid" /> — the syntax is valid and the domain publishes mail (MX) records. This does <strong>not</strong> prove the mailbox exists.
              </li>
              <li>
                <VerificationBadge status="unverified" /> — not checked yet.
              </li>
              <li>
                <VerificationBadge status="invalid" /> — bad syntax, disposable domain, or the domain can’t receive email.
              </li>
              <li>
                <VerificationBadge status="unknown" /> — the DNS check couldn’t complete (e.g. timeout); it will be retried.
              </li>
            </ul>
            <p>LeadOrbit never invents or guesses email addresses or phone numbers. Contacts come only from what a business or an authorized source publishes.</p>
          </Section>

          <Section id="website-analysis" title="Website analysis">
            <p>The analyzer fetches a site’s public homepage (and a few internal links and its contact page), obeying robots.txt and refusing private-network addresses. It records detected technologies with the evidence for each (meta generator, HTTP headers, script URLs) and two kinds of issues:</p>
            <ul>
              <li>
                <strong>Measured</strong> — objectively checked: HTTP errors, missing HTTPS or redirect, invalid/expiring SSL, broken links, missing title/description/viewport/H1/lang, images without alt text, outdated jQuery or CMS versions, slow server response, Lighthouse scores (when PageSpeed is enabled).
              </li>
              <li>
                <strong>Heuristic</strong> — signs that suggest, but don’t prove, an outdated site: legacy markup (&lt;font&gt;, table layouts, Flash), an old footer copyright year.
              </li>
            </ul>
            <p>Opportunities (e.g. “Potential WordPress redesign”) are derived only from recorded issues, list their evidence, and carry a confidence level. Technical signals never tell us what an owner intends to buy.</p>
          </Section>

          <Section id="monitoring" title="Monitoring & schedules">
            <p>Rules run hourly, daily, weekly, at a custom interval (min. 15 minutes) or manually — but never faster than each source allows. All built-in sources publish periodically, so LeadOrbit never claims real-time updates. Each run only asks for records changed since the last successful run when the source supports it.</p>
            <p>Failed runs retry with exponential backoff (30s, 2m, 8m, 32m). After the last attempt the job is marked failed, you get a notification, and you can retry it from Jobs & activity.</p>
          </Section>

          <Section id="notifications" title="Notifications & email">
            <p>In-app and browser notifications work out of the box. For email, set <code className="font-mono text-xs">SMTP_HOST</code>, <code className="font-mono text-xs">SMTP_PORT</code>, <code className="font-mono text-xs">SMTP_USER</code>, <code className="font-mono text-xs">SMTP_PASSWORD</code> and <code className="font-mono text-xs">SMTP_FROM</code> on the server (free options: a Gmail app password, Brevo or Mailjet free tiers). Choose immediate alerts or a daily summary, minimum score, countries and quiet hours under Notifications → Preferences.</p>
          </Section>

          <Section id="webhooks" title="Webhooks & CRM">
            <p>
              Webhooks POST JSON for <code className="font-mono text-xs">lead.created</code>, <code className="font-mono text-xs">lead.qualified</code> and <code className="font-mono text-xs">lead.status_changed</code>. Verify <code className="font-mono text-xs">X-LeadOrbit-Signature</code> = <code className="font-mono text-xs">sha256=</code>HMAC-SHA256(secret, <code className="font-mono text-xs">timestamp + &quot;.&quot; + body</code>) and reject old timestamps. Example (Node):
            </p>
            <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-xs">{`const expected = "sha256=" + crypto.createHmac("sha256", SECRET)
  .update(req.headers["x-leadorbit-timestamp"] + "." + rawBody).digest("hex");
if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-leadorbit-signature"]))) reject();`}</pre>
            <p>HubSpot’s free CRM is supported directly (Data sources → HubSpot); other CRMs can be connected through webhooks and free automation tools like n8n.</p>
          </Section>

          <Section id="privacy" title="Privacy & opt-out requests">
            <p>LeadOrbit collects only business information that sources publish for business purposes. When a business asks to be removed, use “Suppress contact data” on its lead: contacts are deleted and future collection is blocked. Admins can export all workspace data as JSON and owners can delete a workspace under Settings → Privacy & data. Review the privacy policy and terms templates with a lawyer before offering LeadOrbit to others.</p>
          </Section>

          <Section id="shortcuts" title="Keyboard shortcuts">
            <ul>
              <li>
                <kbd className="rounded border border-border px-1 text-xs">⌘K</kbd> / <kbd className="rounded border border-border px-1 text-xs">Ctrl K</kbd> or <kbd className="rounded border border-border px-1 text-xs">/</kbd> — focus global search
              </li>
              <li>
                <kbd className="rounded border border-border px-1 text-xs">Tab</kbd> — every control is reachable by keyboard; a “Skip to content” link appears first
              </li>
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardBody className="space-y-2">
        <h2>{title}</h2>
        {children}
      </CardBody>
    </Card>
  );
}
