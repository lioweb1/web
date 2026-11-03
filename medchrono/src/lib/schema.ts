import { z } from "zod";

/**
 * What the model returns for one chunk of pages. Page numbers are relative to
 * the chunk (page 1 = first page of the attachment); the server converts them
 * to absolute page numbers of the source file.
 */
export const ENCOUNTER_TYPES = [
  "office_visit",
  "emergency",
  "hospital_admission",
  "surgery",
  "imaging",
  "lab",
  "therapy",
  "pharmacy",
  "telehealth",
  "other",
] as const;

export const EncounterSchema = z.object({
  date: z.string().nullable().describe("Date of service as YYYY-MM-DD, or null if the page gives no usable date"),
  date_text: z.string().describe("The date exactly as written in the record"),
  provider_name: z.string().describe("Treating clinician, e.g. 'Dr. Sarah Kim, MD'. Empty string if unknown"),
  facility: z.string().describe("Clinic, hospital or practice name. Empty string if unknown"),
  specialty: z.string().describe("e.g. Orthopedics, Emergency Medicine, Physical Therapy"),
  encounter_type: z.enum(ENCOUNTER_TYPES),
  chief_complaint: z.string(),
  diagnoses: z.array(z.string()),
  icd10_codes: z.array(z.string()),
  procedures: z.array(z.string()),
  cpt_codes: z.array(z.string()),
  medications: z.array(z.string()),
  findings: z.string().describe("Objective findings, imaging impressions, test results"),
  plan: z.string().describe("Treatment plan, referrals, follow-up"),
  pain_score: z.number().nullable().describe("0-10 pain score if documented"),
  work_status: z.string().nullable().describe("Work restrictions / off work, if documented"),
  significance: z.enum(["high", "medium", "low"]).describe(
    "high = injury mechanism, new diagnosis, surgery, imaging with positive findings, causation statement, permanent impairment; low = routine refill or admin",
  ),
  quote: z.string().describe("A short verbatim quote (max ~25 words) that best supports this entry"),
  page_start: z.number().int(),
  page_end: z.number().int(),
});

export const BillSchema = z.object({
  date: z.string().nullable().describe("Date of service YYYY-MM-DD"),
  provider_name: z.string(),
  facility: z.string(),
  description: z.string(),
  cpt_code: z.string().nullable(),
  amount_charged: z.number().describe("Billed amount in USD"),
  amount_paid: z.number().nullable().describe("Paid / adjusted amount if shown"),
  page: z.number().int(),
});

export const ReferencedRecordSchema = z.object({
  provider_name: z.string().describe("Provider or facility the record would come from"),
  record_type: z.string().describe("e.g. MRI report, ER visit, PT notes, prior primary care records"),
  date_text: z.string().describe("Date or period mentioned, or empty string"),
  date: z.string().nullable().describe("YYYY-MM-DD if a specific date is given"),
  reason: z.string().describe("Why the text implies this record exists, e.g. 'Referred to Dr. Patel for EMG'"),
  page: z.number().int(),
});

export const PriorConditionSchema = z.object({
  condition: z.string(),
  evidence: z.string().describe("Short verbatim evidence"),
  page: z.number().int(),
});

export const ChunkExtractionSchema = z.object({
  patient_name: z.string().nullable(),
  patient_dob: z.string().nullable(),
  incident_date: z.string().nullable().describe("Date of the accident / injury if the records mention it, YYYY-MM-DD"),
  incident_description: z.string().nullable(),
  encounters: z.array(EncounterSchema),
  bills: z.array(BillSchema),
  referenced_records: z.array(ReferencedRecordSchema).describe(
    "Records, visits, imaging, referrals or prior treatment that this text MENTIONS. Include them even if they may be elsewhere in the file; matching happens later.",
  ),
  prior_conditions: z.array(PriorConditionSchema).describe("Pre-existing conditions, prior injuries or prior treatment of the same body part"),
});

export type ChunkExtraction = z.infer<typeof ChunkExtractionSchema>;
export type RawEncounter = z.infer<typeof EncounterSchema>;
export type RawBill = z.infer<typeof BillSchema>;
export type RawReferencedRecord = z.infer<typeof ReferencedRecordSchema>;
export type RawPriorCondition = z.infer<typeof PriorConditionSchema>;

/** A source citation: which uploaded file, which absolute page(s). */
export type SourceRef = { file: string; page_start: number; page_end: number };

export type Encounter = Omit<RawEncounter, "page_start" | "page_end"> & { id: string; source: SourceRef };
export type Bill = Omit<RawBill, "page"> & { id: string; source: SourceRef };
export type ReferencedRecord = Omit<RawReferencedRecord, "page"> & { id: string; source: SourceRef };
export type PriorCondition = Omit<RawPriorCondition, "page"> & { id: string; source: SourceRef };

/** Everything extracted from every uploaded file, before analysis. */
export type CaseExtraction = {
  case_name: string;
  files: { name: string; pages: number }[];
  patient_name: string | null;
  patient_dob: string | null;
  incident_date: string | null;
  incident_description: string | null;
  encounters: Encounter[];
  bills: Bill[];
  referenced_records: ReferencedRecord[];
  prior_conditions: PriorCondition[];
  warnings: string[];
};
