import type { CaseExtraction } from "./schema";
import type { MissingRecord } from "./analyze";

export type FirmInfo = { firm: string; attorney: string; address: string; phone: string; email: string };

export const DEFAULT_FIRM: FirmInfo = {
  firm: "[Your Law Firm]",
  attorney: "[Attorney Name], Esq.",
  address: "[Street, City, State ZIP]",
  phone: "[Phone]",
  email: "[Email]",
};

/** HIPAA-style medical records request for one missing record (45 CFR 164.524 / authorization enclosed). */
export function recordsRequestLetter(x: CaseExtraction, m: MissingRecord, firm: FirmInfo = DEFAULT_FIRM, today = new Date()): string {
  const date = today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const period = m.record.date_text || (x.incident_date ? `${x.incident_date} to present` : "all available dates");
  return `${firm.firm}
${firm.address}
${firm.phone} · ${firm.email}

${date}

Custodian of Records
${m.record.provider_name}

RE: Request for Medical Records
Patient: ${x.patient_name ?? "[Patient Name]"}
Date of Birth: ${x.patient_dob ?? "[DOB]"}
Dates of Service: ${period}

Dear Custodian of Records:

This office represents the above-named patient. Enclosed is a HIPAA-compliant authorization signed by the patient. Please provide complete and certified copies of the following:

  • ${m.record.record_type}
  • All office/progress notes, reports, imaging and test results, and correspondence for the dates above
  • An itemized billing statement (with CPT codes) and payment ledger for the same period

Our review of the patient's records indicates these records exist: "${m.record.reason}" (${m.record.source.file}, page ${m.record.source.page_start}).

Electronic copies (PDF) are preferred and may be sent to ${firm.email}. If a fee applies, please send an invoice in advance. We ask that the records be produced within 30 days, consistent with 45 CFR § 164.524.

Thank you for your prompt attention.

Sincerely,

${firm.attorney}
${firm.firm}

Enclosure: HIPAA Authorization
`;
}
