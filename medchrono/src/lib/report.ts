import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { CaseAnalysis } from "./analyze";
import type { CaseExtraction } from "./schema";
import { recordsRequestLetter, type FirmInfo } from "./letters";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const cite = (s: { file: string; page_start: number; page_end: number }) =>
  `${s.file} p.${s.page_start}${s.page_end > s.page_start ? `–${s.page_end}` : ""}`;

const NAVY = "1E3A5F";
const border = { style: BorderStyle.SINGLE, size: 4, color: "C8D1DC" };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(text: string, opts: { header?: boolean; width?: number; bold?: boolean } = {}): TableCell {
  return new TableCell({
    borders,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header ? { type: ShadingType.CLEAR, color: "auto", fill: NAVY } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: text.split("\n").map(
      (line) => new Paragraph({ children: [new TextRun({ text: line, size: 17, bold: opts.header || opts.bold, color: opts.header ? "FFFFFF" : undefined })] }),
    ),
  });
}

function table(headers: string[], widths: number[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { header: true, width: widths[i] })) }),
      ...rows.map((r) => new TableRow({ children: r.map((v, i) => cell(v, { width: widths[i] })) })),
    ],
  });
}

const h1 = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 }, children: [new TextRun({ text: t, color: NAVY })] });
const p = (t: string, bold = false) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: t, bold, size: 20 })] });

/** Builds the attorney-ready Word report. Runs in the browser; nothing leaves the device. */
export async function buildDocx(x: CaseExtraction, a: CaseAnalysis, firm: FirmInfo): Promise<Blob> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: "MEDICAL CHRONOLOGY & CASE REVIEW", bold: true, size: 32, color: NAVY })] }),
    p(x.case_name, true),
    p(`Patient: ${x.patient_name ?? "—"}   DOB: ${x.patient_dob ?? "—"}   Date of incident: ${x.incident_date ?? "—"}`),
    p(`Records reviewed: ${x.files.map((f) => `${f.name} (${f.pages} pp.)`).join(", ")}`),
    p(`Prepared for ${firm.firm} · ${new Date().toLocaleDateString("en-US")} · ATTORNEY WORK PRODUCT — PRIVILEGED & CONFIDENTIAL`),

    h1("1. Executive summary"),
    p(`${a.chronology.length + a.undated.length} encounters with ${a.providers.length} providers. Total billed ${usd(a.totals.billed)}${a.totals.paid ? `, paid/adjusted ${usd(a.totals.paid)}` : ""}.`),
    p(`Documentation strength: ${a.case_strength.score}/100 — ${a.case_strength.label}.`, true),
    ...a.case_strength.reasons.map((r) => p(`• ${r}`)),
    ...(x.incident_description ? [p(`Mechanism of injury: ${x.incident_description}`)] : []),

    h1("2. Red flags & defense risks"),
    a.red_flags.length
      ? table(["Severity", "Issue", "Detail", "Source"], [10, 25, 45, 20], a.red_flags.map((f) => [f.severity.toUpperCase(), f.title, f.detail, f.file ? `${f.file} p.${f.page}` : ""]))
      : p("None identified."),

    h1("3. Medical chronology"),
    table(
      ["Date", "Provider / facility", "Summary", "Source"],
      [11, 22, 49, 18],
      [...a.chronology, ...a.undated].map((e) => [
        e.date ?? e.date_text,
        `${e.provider_name}\n${e.facility}\n${e.specialty}`,
        [
          e.chief_complaint && `CC: ${e.chief_complaint}`,
          e.diagnoses.length && `Dx: ${e.diagnoses.join("; ")}${e.icd10_codes.length ? ` (${e.icd10_codes.join(", ")})` : ""}`,
          e.procedures.length && `Procedures: ${e.procedures.join("; ")}`,
          e.findings && `Findings: ${e.findings}`,
          e.plan && `Plan: ${e.plan}`,
          e.medications.length && `Meds: ${e.medications.join("; ")}`,
          e.pain_score !== null && `Pain: ${e.pain_score}/10`,
          e.work_status && `Work: ${e.work_status}`,
          e.quote && `“${e.quote}”`,
        ]
          .filter(Boolean)
          .join("\n"),
        cite(e.source),
      ]),
    ),

    h1("4. Treatment gaps"),
    a.gaps.length
      ? table(["Gap", "Last visit before", "Next visit", "Days"], [10, 35, 35, 20], a.gaps.map((g, i) => [`#${i + 1}`, `${g.from.date} — ${g.from.provider_name}`, `${g.to.date} — ${g.to.provider_name}`, String(g.days)]))
      : p("No gaps over the threshold."),

    h1("5. Medical specials (billing summary)"),
    table(
      ["Provider", "Specialty", "Visits", "Dates", "Billed", "Paid"],
      [28, 18, 8, 22, 12, 12],
      [
        ...a.providers.map((pr) => [pr.clinicians.length ? `${pr.provider}\n${pr.clinicians.join(", ")}` : pr.provider, pr.specialty, String(pr.visits), `${pr.first_visit ?? ""}${pr.last_visit && pr.last_visit !== pr.first_visit ? ` → ${pr.last_visit}` : ""}`, usd(pr.billed), usd(pr.paid)]),
        ["TOTAL", "", String(a.totals.visits), "", usd(a.totals.billed), usd(a.totals.paid)],
      ],
    ),
    ...(a.billing_issues.length ? [p(""), p("Billing issues", true), ...a.billing_issues.map((i) => p(`• [${i.severity}] ${i.message}`))] : []),

    h1("6. Missing records"),
    a.missing_records.length
      ? table(["Provider", "Record", "Why we believe it exists", "Source"], [22, 20, 40, 18], a.missing_records.map((m) => [m.record.provider_name, m.record.record_type, m.record.reason, cite(m.record.source)]))
      : p("All referenced records appear to be in the file."),
  ];

  if (x.warnings.length) {
    children.push(h1("Processing notes"), ...x.warnings.map((w) => p(`• ${w}`)));
  }
  children.push(
    p(""),
    p("This review was generated with AI assistance and must be verified against the source records by a qualified reviewer before use. It is not medical advice or a medical opinion."),
  );
  for (const m of a.missing_records) {
    children.push(new Paragraph({ children: [new PageBreak()] }), ...recordsRequestLetter(x, m, firm).split("\n").map((l) => p(l)));
  }

  const doc = new Document({
    creator: "MedChrono AI",
    title: `${x.case_name} — Medical Chronology`,
    styles: { default: { document: { run: { font: "Calibri" } } } },
    sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } }, children }],
  });
  return Packer.toBlob(doc);
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function chronologyCsv(a: CaseAnalysis): string {
  const head = ["date", "provider", "facility", "specialty", "type", "chief_complaint", "diagnoses", "icd10", "procedures", "cpt", "findings", "plan", "pain", "work_status", "significance", "file", "page_start", "page_end"];
  const rows = [...a.chronology, ...a.undated].map((e) => [
    e.date ?? e.date_text, e.provider_name, e.facility, e.specialty, e.encounter_type, e.chief_complaint, e.diagnoses.join("; "), e.icd10_codes.join("; "),
    e.procedures.join("; "), e.cpt_codes.join("; "), e.findings, e.plan, e.pain_score, e.work_status, e.significance, e.source.file, e.source.page_start, e.source.page_end,
  ]);
  return [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}

export function billingCsv(x: CaseExtraction): string {
  const head = ["date", "provider", "facility", "description", "cpt", "charged", "paid", "file", "page"];
  const rows = x.bills.map((b) => [b.date, b.provider_name, b.facility, b.description, b.cpt_code, b.amount_charged, b.amount_paid, b.source.file, b.source.page_start]);
  return [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}
