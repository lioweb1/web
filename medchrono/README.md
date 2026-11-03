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

```bash
cd medchrono
npm install
cp .env.example .env    # add ANTHROPIC_API_KEY
npm run dev             # http://localhost:3000
```

- `/` is the sales landing page (features, ROI calculator, pricing).
- `/workspace` is the product. Upload PDFs, or open `/workspace?demo=1` for a fictional demo case that works without an API key.

Tests and checks:

```bash
npm test
npm run typecheck
npm run build
```

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
- **Next features buyers ask for:** user accounts and teams, Stripe billing, demand-letter draft generation, deposition summaries, integrations with Clio, Filevine and Litify, and OCR quality warnings for faxes.

> AI-assisted output. Every entry must be verified against the cited page by a qualified reviewer. It is not medical or legal advice.
