# MedChrono AI

**A 10-day medical record review, done in an hour.**

MedChrono AI turns thousands of pages of medical records into an attorney-ready, page-cited medical chronology. It goes further than a summary: it also finds missing records, treatment gaps the defense will attack, and billing errors.

Built for **personal-injury and workers' comp law firms, medical-malpractice firms, insurers, TPAs and IME vendors**. These buyers pay nurse consultants $75–$150/hour to do this work by hand today.

## What makes it different

| Feature | What it does |
|---|---|
| **Missing-records detector** | Lists every MRI, EMG, referral or prior provider the records *mention* but the file doesn't *contain*. Drafts a HIPAA records-request letter for each one. |
| **Defense-risk radar** | Flags delay to first care, treatment gaps (configurable threshold), pre-existing conditions and pain-score rebounds, each with its source page. |
| **Medical specials reconciliation** | Shows billed vs. paid by provider, duplicate line items, charges with no treatment note, and visits that were never billed. |
| **Page-cited chronology** | Every entry has file + page + a verbatim quote. Clicking a citation opens the uploaded PDF at that page. |
| **Documentation strength score** | A 0–100 score where every deduction is explained. |
| **Zero retention** | PDFs are processed in memory and never stored on the server. Reports (Word/CSV), letters and saved case files are generated in the browser. |

## Run it

You need Node 20+ and PostgreSQL 14+. Tables are created automatically the first time the app connects.

```bash
cd medchrono
npm install
cp .env.example .env    # fill in ANTHROPIC_API_KEY, DATABASE_URL, STRIPE_* (see below)
npm run dev             # http://localhost:3000
```

| Page | What it is |
|---|---|
| `/` | Sales landing page with features, ROI calculator and pricing |
| `/demo` | Public fictional demo case. Works without an API key, account or database. |
| `/signup`, `/login` | Accounts. Each signup creates a firm account with 1 free trial case of up to 300 pages. |
| `/workspace` | The product: upload, analyze, export. Requires sign-in. |
| `/billing` | Credit balance, Firm plan subscription, credit packs, usage history |
| `/team` | Invite teammates by email, change roles, remove members. Owners manage; members run cases. |
| `/forgot-password`, `/reset-password` | Password reset by email |
| `/terms`, `/privacy` | Terms of Service (including a Business Associate Addendum) and Privacy Policy |
| `/api/health` | Health check for the load balancer |

Tests and checks:

```bash
npm test                 # unit tests; database tests are skipped
npm run test:db          # also runs the PostgreSQL integration tests (set TEST_DATABASE_URL to a throwaway DB)
npm run typecheck
npm run build
```

## Accounts, credits and payments

- **Accounts:** email and password, hashed with scrypt. Sessions use a random token in an httpOnly, SameSite=Lax cookie; only its SHA-256 hash is stored. Login is throttled (8 failures per email or 32 per IP per 15 minutes). Every state-changing endpoint rejects cross-site requests.
- **Credits** (`src/lib/plans.ts`): 1 credit = 1 case of up to 1,000 pages, and larger cases cost 1 credit per started 1,000 pages. The free trial is used first, then monthly plan credits (these reset every billing cycle and don't roll over), then purchased credits (these never expire).
- **Usage limits** (`src/lib/credits.ts`): before any AI call, the server counts the pages and takes the credits inside a row-locked transaction, so parallel uploads can't overspend. At most 2 cases per firm can process at once. If nothing could be analyzed, or the user cancels, the credit is refunded automatically.
- **Password reset:** a single-use emailed link that expires after 1 hour, limited to 3 requests per hour, and stored only as a hash. The response never reveals whether an email has an account. Resetting signs the user out everywhere.
- **Teams:** everyone in a firm shares its credits. Owners invite people by email (single-use link, valid 7 days), change roles and remove members. Removing someone signs them out at once, and a firm always keeps at least one owner. Seats: 3 on the free and pay-per-case plans, 10 on the Firm plan. Only owners can buy credits or change the plan.
- **Privacy:** the database stores accounts, billing and page counts only. Case names, patient names and file names are never stored.

### Stripe setup (about 10 minutes)

Prices are defined in code, so you don't need to create products in the Stripe dashboard.

1. Create a Stripe account and copy the **secret key** (`sk_test_...` while testing) into `STRIPE_SECRET_KEY`.
2. In Dashboard → Developers → Webhooks, add the endpoint `https://YOUR_DOMAIN/api/stripe/webhook` with these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. In Dashboard → Settings → Billing → Customer portal, turn on the portal. The "Manage subscription & invoices" button uses it.
4. For local testing, run the Stripe CLI: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, and use the `whsec_...` value it prints.

Credits are granted **only** from signed webhook events. Coming back to `/billing?status=success` never adds credits by itself, and each event is processed exactly once.

## Deploying to AWS

Use `docker compose up --build` to run a production-like stack locally (app plus PostgreSQL).

For production, **[infra/aws/DEPLOY.md](infra/aws/DEPLOY.md)** walks through one CloudFormation stack (`infra/aws/medchrono.yml`): an HTTPS load balancer, ECS Fargate with autoscaling, encrypted RDS PostgreSQL in private subnets, Secrets Manager, ECR, CloudWatch logs and alarms. Releases go out with `scripts/deploy-aws.sh`, which rolls back automatically if a release fails its health check.

## How it works

1. `POST /api/analyze` (`src/app/api/analyze/route.ts`) receives the PDFs. It splits each one into chunks of 30 pages (`MEDCHRONO_PAGES_PER_CHUNK`) with `pdf-lib`, so page citations stay exact.
2. Each chunk goes to Claude (`claude-opus-5-5`, `src/lib/extract.ts`) as a PDF document, three chunks at a time. Claude returns JSON validated against a Zod schema (`src/lib/schema.ts`) with encounters, bills, referenced records and prior conditions. The server-side refusal fallback (`fallbacks: "default"`) is enabled. If a chunk fails or is refused, the case still finishes and the report lists a warning telling the reviewer to check those pages manually.
3. Progress streams back to the browser as NDJSON. Chunk results are merged and their page numbers made absolute (`src/lib/merge.ts`).
4. The browser runs deterministic analysis (`src/lib/analyze.ts`): chronology, gaps, missing records, provider/billing reconciliation, red flags and the score. The analysis is unit-tested and needs no AI, so changing a setting such as the gap threshold updates it instantly.
5. Export: Word report with request letters appended (`src/lib/report.ts`, `docx`), chronology and billing CSVs, and a `.medchrono.json` case file to reopen later.

## Going to market: checklist

- **Compliance:** sign a BAA with Anthropic (or use Claude through AWS Bedrock / Google Vertex under your cloud BAA) and with your host. Add authentication, audit logging and encryption at rest if you ever add storage. Get SOC 2 Type I once you have paying customers.
- **Pricing** (shown on the landing page; adjust freely): $149 per case (≤1,000 pages), $1,490/month firm plan, enterprise private deployment from $60k/year.
- **First customers:** offer 3–5 PI firms a free pilot on closed cases. Measure the hours saved and use those numbers as case studies.
- **Legal:** `/terms` and `/privacy` are solid drafts, but a U.S. attorney must review them before launch. Set the `NEXT_PUBLIC_LEGAL_*` values so the draft banner disappears.
- **Still to build:** demand-letter draft generation, deposition summaries, integrations with Clio, Filevine and Litify, and OCR quality warnings for faxes.

> AI-assisted output. Every entry must be verified against the cited page by a qualified reviewer. It is not medical or legal advice.
