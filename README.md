# LeadOrbit AI

Lead discovery, website and domain intelligence, explainable lead scoring and a mini-CRM for web agencies, freelancers and B2B sellers. **Every built-in data source is free** and used through its official, permitted interface. Nothing scrapes social networks or bypasses logins, CAPTCHAs or rate limits.

- **Stack:** Next.js 16 (App Router, server actions), TypeScript, Tailwind CSS 4, Radix UI and cmdk components, PostgreSQL 14+ with row-level security, Drizzle ORM, and a PostgreSQL-backed job queue with a worker process.
- **Cost to run:** you pay only for hosting (a small VPS, or free tiers; see [Deployment](#deployment)).

---

## What it does

| Area | What's implemented |
|---|---|
| Global targeting | All ISO 3166 countries with search, multi-select, regions and country groups. **Premium Markets** is the default preset, and every new workspace gets it as its default target market. Saved target markets, All countries, and custom selections. |
| Discovery | Discovery runs per data source (manual or scheduled). Each run normalizes names, URLs, phone numbers and emails, deduplicates by upstream key, then domain, then name + country + city, matches your criteria, and stores the result with field-level provenance (`source_observations`). |
| Domain intelligence | Newly observed domains from Certificate Transparency, RDAP registration date / registrar / status, DNS A and MX records, SSL status, and website status. |
| Website intelligence | CMS, eCommerce, framework, CDN and hosting detection with evidence. Measured issues (SSL, HTTPS redirect, viewport, metadata, alt text, broken links, HTTP errors, response time, outdated jQuery/WordPress, optional Lighthouse) are shown separately from heuristic ones (legacy markup, stale copyright). Opportunities are derived only from recorded issues and always carry their evidence. |
| Contact enrichment | Emails, phone numbers, contact pages and company LinkedIn / Facebook / Instagram / X links that a business publishes on its own website, in its schema.org data or in its OpenStreetMap listing. Email checks cover syntax, MX records and null-MX. The statuses are **Verified by provider / Domain valid / Unverified / Invalid / Unknown**; an MX record never upgrades an address to "Verified". |
| Business signals | Hacker News launches and "looking for a web developer" posts, plus RSS/Atom feeds you choose. A transparent keyword classifier sorts them into launch, website, redesign, eCommerce, hosting/migration or general update, and records the phrases that matched. |
| Monitoring | Rules with countries, cities, industries, categories, keyword, website state, TLDs, sources, score threshold, contact requirement, auto-analyze, auto-tag, auto-list, notifications, and a frequency (manual / hourly / daily / weekly / custom). Intervals are clamped to each provider's permitted minimum. Each rule shows its last run, next run, errors and stats. |
| Scoring | 0–100 from 10 evidence-backed factors. A factor with no evidence scores 0 and is listed as missing information. Each lead shows its confidence level and a recommended next step. The 5 categories (Excellent Match through Weak Match) are qualification categories, not purchase probabilities. |
| CRM | 10 pipeline statuses, notes, tags, lists, priorities, owners, follow-ups and tasks, a communication log, activity timeline, merge duplicates, archive, delete, CSV import, and bulk actions. |
| Search | Keyword search plus about 30 filters, sorting, pagination, saved searches, search history, quick filters, bulk tag and export, and saving a search as a monitoring rule. |
| Notifications | In-app notification center and bell, browser notifications (with your permission), and email (immediate or daily digest) over your SMTP server. Per-type toggles, minimum score, country filters, quiet hours, and duplicate prevention. Every notification links to its lead and source. |
| Social autopilot | Finds trending posts in your niche (Hacker News, Google News, Reddit RSS, Bluesky search, your RSS feeds). A free-tier AI (Gemini by default; Groq, OpenRouter or self-hosted Ollama also work) writes original clickbait-style, SEO-aware posts: 3 scored hook variants, an SEO keyword, mixed hashtags, image alt text, platform-specific versions for LinkedIn and Instagram, a short version and a thread. Posts publish to a Facebook Page, Instagram, Threads, Bluesky, Mastodon, a Telegram channel, a Discord channel and LinkedIn through official APIs, with a branded image card, UTM-tagged links and A/B hook rotation. Approved posts go out at your posting times (calendar view, reschedule). Comments on Facebook/Instagram/Threads/Bluesky/Mastodon get AI reply drafts or automatic replies. Likes/comments/shares are pulled into an analytics page, and the best hooks feed back into the prompt. Drafts and replies can be approved from your phone through Telegram buttons. |
| Automation | Signed webhooks (work with Zapier, Make or n8n), push to HubSpot's free CRM, auto-tagging, lists, follow-up reminders, and scheduled discovery. |
| Analytics | KPIs and charts computed from stored data only, with empty states when there is no data. |
| Security | scrypt password hashing, httpOnly session cookies with hashed tokens, PostgreSQL RLS on every workspace table, AES-256-GCM encrypted API keys (never sent to the browser), DB-backed rate limiting, zod validation, SSRF protection on every outbound fetch of user-supplied URLs, audit logs, data export and deletion, and opt-out suppression. |

### Data sources (all free)

| Source | Key needed? | Coverage / notes |
|---|---|---|
| **OpenStreetMap** (Overpass + Nominatim) | No | Worldwide local businesses: name, category, address, website, phone, email. Ideal for finding businesses without websites. One country + up to 5 cities per run. ODbL: attribution is shown. |
| **UK Companies House** | Free key | Newly incorporated UK companies with registry-verified incorporation dates and SIC industry codes. |
| **Certificate Transparency** (crt.sh) | No | Newly observed domains matching a keyword and TLD. A new certificate is a setup signal, not a registration date. |
| **RDAP** (IANA bootstrap) | No | Domain registration date, registrar and status. |
| **Hacker News Search** (Algolia) | No | Product launches and public requests for web work. Usually no location. |
| **RSS / Atom feeds** | No | Any public feeds you configure: press-release wires, local news, startup blogs. |
| **Website analyzer** (built-in) | No | Runs on your server. Respects robots.txt and makes a small number of requests per site. |
| **DNS email checks** (built-in) | No | Syntax and MX checks. |
| **Google PageSpeed Insights** | Optional free key | Lighthouse scores. Off by default because each test takes 10–30 s. |
| **HubSpot free CRM** | Free private-app token | Push qualified leads as Companies. |
| LinkedIn / Facebook | — | **Not available.** Their APIs don't allow third-party monitoring of other companies' posts or pages, and scraping is prohibited. Company page links are still collected from businesses' own websites and map listings. |

**Coverage is limited to what these sources expose.** The app never claims global coverage, real-time updates or purchase intent.

---

## Quick start (local)

Requirements: Node.js 22+, and PostgreSQL 14+ (or Docker).

```bash
npm install
cp .env.example .env
# Generate the encryption key and put it in APP_ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Start PostgreSQL with Docker (it creates the dev roles and databases from `scripts/docker-init.sql`):

```bash
docker compose up -d db
```

Or set it up on an existing server as a superuser, using `scripts/setup-db.sql`.

Then create the tables and start the app:

```bash
npm run db:migrate
npm run dev          # http://localhost:3000
npm run worker       # in a second terminal: scheduler + background jobs
```

Register at `/register`. Your workspace starts with the Premium Markets target. Then:

1. **Data sources** (`/app/integrations`): click *Test connection* on each source. A source only shows "Connected" after a passing test.
2. **Discover**: pick OpenStreetMap, choose one country and a city, optionally choose categories or "No website", then run it.
3. Save the results as leads. Enrichment (website analysis, RDAP, email checks) and scoring run in the background worker.
4. **Monitoring rules**: automate the same search on a schedule and get notified about leads that qualify.

### Free API keys (optional)

- **Companies House:** create an account at <https://developer.company-information.service.gov.uk/>, create an application, add a **REST** key, and paste it in *Data sources → UK Companies House*.
- **PageSpeed Insights:** in Google Cloud Console, enable the *PageSpeed Insights API*, create an API key, and paste it in *Data sources → Google PageSpeed Insights*. Then enable that source.
- **HubSpot:** go to *Settings → Integrations → Private apps*, create an app with the `crm.objects.companies.read` and `crm.objects.companies.write` scopes, and paste the token.

Keys are encrypted with `APP_ENCRYPTION_KEY` before they are stored. Changing that key makes stored keys unreadable, so re-enter them if you do.

### Social autopilot (free)

Open *Social autopilot → Settings & connections*.

1. **AI writer:** create a free key at <https://aistudio.google.com/apikey> and paste it in *Google Gemini*. Free-tier limits change from time to time, so check AI Studio. Free-tier prompts may be used by Google to improve its models, so don't put private data in them. Groq and OpenRouter (`:free` models) also have free tiers. For Ollama, set `OLLAMA_URL`.
2. **Accounts:** connect the platforms you want. Each card links to the official setup guide.
   - **Facebook Page:** use a Page access token with `pages_manage_posts` and the Page ID.
   - **Instagram:** needs a Business or Creator account linked to a Page, a token with `instagram_content_publish`, and a public image for every post.
   - **Threads:** use a token with `threads_content_publish`.
   - **Bluesky:** use your handle and an *app password*.
   - **Mastodon:** use the instance URL and a token with `write:statuses`.
   - **Telegram:** use a bot token from @BotFather. The bot must be an admin of the channel.
   - **Discord:** use a channel webhook URL.
   - **LinkedIn:** use a member token with `w_member_social` and `openid profile`. It expires after about 60 days.
3. **Autopilot:** enter niche keywords, your link and brand voice, then choose the sources, platforms, mode and daily limit, and switch it on. The worker scans on the interval you set.
4. **Scheduling:** set posting times (e.g. `09:00, 13:00, 20:00`) and your time zone. Approved posts take the next free slot. Move them on *Calendar*.
5. **Comments:** choose *AI drafts replies, I approve* or *AI replies automatically* (with a daily cap). Comments are checked every 30 minutes, and metrics every 3 hours. These need the read permissions too: `pages_read_engagement` + `pages_manage_engagement` (Facebook), `instagram_manage_comments` (Instagram), `threads_read_replies` + `threads_manage_replies` + `threads_manage_insights` (Threads).
6. **Phone approvals:** in the Telegram connection, set *Your chat ID for approvals*. Send `/start` to your bot first. New drafts and replies arrive with ✅ / 🚀 / 🔄 / ❌ buttons, and replying to a draft message replaces its text. Only that chat ID is obeyed. The worker polls the bot, so no public webhook is needed. Don't set a webhook on the same bot.
7. **Image cards:** branded 1080×1080 JPEG cards are served from `APP_URL/api/social/image/…` (signed URLs). Facebook, Instagram and Threads fetch them, so `APP_URL` must be a public HTTPS address. Bangla text uses Noto Sans Bengali.

X (Twitter) is not supported because its API charges for posting, and automating it outside the API breaks its rules. Nothing in the autopilot scrapes or logs in to a social network's website.

### Email alerts (optional, free)

Set the `SMTP_*` variables. Any SMTP server works, for example a Gmail account with an app password (`smtp.gmail.com:587`) or a free tier of a transactional email service. Without SMTP, in-app and browser notifications still work.

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_OWNER_URL` | yes | Table owner. Used for migrations, authentication, the job queue and the scheduler. |
| `DATABASE_APP_URL` | yes | Restricted role. Every workspace query runs here with RLS. |
| `APP_ENCRYPTION_KEY` | yes | 32 random bytes, base64. Encrypts provider API keys and webhook secrets. |
| `APP_URL` | yes | Public URL, used in emails and webhooks. |
| `PROVIDER_CONTACT_EMAIL` | recommended | Added to the User-Agent. Required by the OpenStreetMap / Nominatim usage policy. |
| `OVERPASS_API_URL`, `NOMINATIM_API_URL` | no | Point to self-hosted instances for heavy use. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | no | Email notifications. |
| `OLLAMA_URL` | no | Self-hosted Ollama server for the social autopilot AI writer, e.g. `http://localhost:11434`. |
| `META_GRAPH_VERSION` | no | Facebook/Instagram Graph API version for social publishing (default `v23.0`). |
| `CRON_SECRET` | no | Protects `POST /api/cron/tick` when you use an external cron instead of the worker. |

---

## Architecture

```
src/
  app/                    Next.js routes (UI pages, server actions, API routes)
    api/cron/tick         scheduler + job processing for serverless hosts
    api/notifications     bell feed / mark read
  components/ui           design system (buttons, tables, country selector, score, badges…)
  lib/
    db/                   Drizzle schema, pools, withTenant() (RLS), migrations
    auth/                 sessions, roles
    providers/            one module per data source + registry + polite HTTP client
    discovery/            normalization, dedupe/upsert with provenance, signal classifier
    analysis/             website analyzer, technology detection, SSRF-safe fetch, email checks
    scoring/              explainable score
    jobs/                 queue (SKIP LOCKED), handlers, scheduler, runner
    notifications/        notify(), email
    services/             leads/CRM, enrichment, integrations, monitoring, accounts, audit, CRM push
src/worker/index.ts       long-running worker
drizzle/                  SQL migrations (0001 = row-level security policies)
tests/                    Vitest integration tests against a real PostgreSQL
```

**Data model.** There is one canonical `businesses` row per real-world business. Rows from public sources are shared between workspaces, and CSV imports stay private to their workspace. Contacts, domains, website analyses and source observations hang off the business. Leads, notes, tags, lists, tasks, activities, rules, notifications, signals and usage are per workspace and isolated by RLS. Source publication date, first discovery date, registration date (set only when a registry states it) and last verification date are separate fields.

**Jobs.** `discovery_run`, then `qualify_business` (enrich → score → save the lead if it meets the rule's threshold and contact requirement → notify / webhook / CRM). Other job types: `enrich_lead`, `send_notification_email`, `send_digest`, `deliver_webhook`, `push_crm` and `task_reminders`. Jobs retry with exponential backoff (30 s, 2 m, 8 m, …) and use idempotency keys. Stale locks are recovered automatically. You can retry or cancel jobs from the UI.

---

## Deployment

Low-cost options:

- **One small VPS** (any provider): run PostgreSQL, `npm run build && npm start` and `npm run worker` under systemd or pm2, behind Caddy or nginx for HTTPS. This is the simplest and most reliable option.
- **Managed free tiers:** use Supabase or Neon for PostgreSQL. Create the two roles with the SQL in `scripts/setup-db.sql`; on Supabase use the direct connection string, not the transaction pooler, because `set_config` must stay in one transaction. Host the web app on a Node host. Run the worker as a background service, **or** have a free external cron call `POST /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` every minute.

Production checklist: set `NODE_ENV=production`, use strong database passwords, use a fresh `APP_ENCRYPTION_KEY`, set `APP_URL` to your HTTPS URL, set `PROVIDER_CONTACT_EMAIL`, configure SMTP, and **have a lawyer review the privacy policy and terms** (`/privacy`, `/terms`, `/data-sources` are templates).

---

## Tests

```bash
createdb leadorbit_test   # owned by leadorbit_owner
npm test
```

The tests run against a real PostgreSQL. Provider responses are replayed from recorded fixtures, so the tests never call the network. They cover:

- every provider mapping;
- dedupe and provenance;
- RLS isolation (reads, writes, password hashes);
- scoring;
- the website analyzer: robots.txt, SSRF, measured vs heuristic issues;
- email statuses;
- the full monitoring flow: scheduler → discovery → qualification → notification, email and signed webhook, plus duplicate prevention;
- job retries, backoff and dead-lettering;
- CRM, import/export and settings.

## Honest limitations

- Public Overpass and Nominatim servers have fair-use limits. For heavy monitoring, self-host them (both are free software) and set the URLs in *Data sources*.
- Without a paid verification provider, email addresses can be at most **Domain valid**. The `verified_by_provider` status exists so a provider can be added later.
- Hacker News and RSS signals often have no location, so country targeting can't apply to them.
- crt.sh can be slow at peak times, so keep keywords specific.
- No payment integration is connected. Plans and limits are configurable fair-use guards.
