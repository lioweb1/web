import type { CaseExtraction, Encounter, Bill } from "./schema";

/**
 * A fictional personal-injury case used for demos and screenshots.
 * All names, facilities and events are invented.
 */
const F1 = "Riverside_ER_and_PCP.pdf";
const F2 = "Orthopedics_and_PT.pdf";
const F3 = "Billing_Ledger.pdf";

type E = Omit<Encounter, "id" | "source"> & { f: string; p: number; q?: number };
const enc = (e: E, i: number): Encounter => {
  const { f, p, q, ...rest } = e;
  return { ...rest, id: `demo_enc_${i}`, source: { file: f, page_start: p, page_end: q ?? p } };
};
const base = {
  icd10_codes: [] as string[],
  cpt_codes: [] as string[],
  medications: [] as string[],
  procedures: [] as string[],
  pain_score: null as number | null,
  work_status: null as string | null,
};

const encounters: Encounter[] = (
  [
    {
      ...base, f: F1, p: 3, q: 7, date: "2026-03-14", date_text: "03/14/2026 18:42",
      provider_name: "Dr. Alicia Moreno, MD", facility: "Riverside General Hospital ED", specialty: "Emergency Medicine",
      encounter_type: "emergency", chief_complaint: "Neck and low back pain after rear-end motor vehicle collision",
      diagnoses: ["Cervical strain", "Lumbar strain", "Headache"], icd10_codes: ["S16.1XXA", "S39.012A", "R51.9"],
      procedures: ["CT cervical spine without contrast"], cpt_codes: ["99284", "72125"], medications: ["Cyclobenzaprine 5 mg", "Ibuprofen 600 mg"],
      findings: "CT C-spine: no acute fracture. Paraspinal tenderness C5–C7 and L4–S1. Restricted ROM.",
      plan: "Discharged. Follow up with PCP in 3–5 days. Return if numbness or weakness.", pain_score: 8, work_status: "Off work 3 days",
      significance: "high", quote: "Restrained driver, stopped at light, struck from behind at approx. 35 mph. Airbags did not deploy.",
    },
    {
      ...base, f: F1, p: 12, q: 14, date: "2026-03-19", date_text: "March 19, 2026",
      provider_name: "Dr. Kevin Osei, DO", facility: "Brookline Family Medicine", specialty: "Primary Care",
      encounter_type: "office_visit", chief_complaint: "Follow-up neck/low back pain post-MVC; new tingling right hand",
      diagnoses: ["Cervical radiculopathy, suspected", "Lumbar strain"], icd10_codes: ["M54.12", "S39.012D"], cpt_codes: ["99214"],
      medications: ["Gabapentin 300 mg"], findings: "Decreased sensation right C6 dermatome. Positive Spurling's on right.",
      plan: "MRI cervical spine ordered at Valley Imaging Center. Referred to orthopedics (Dr. Patel).", pain_score: 7, work_status: "Light duty",
      significance: "high", quote: "Patient reports tingling into right thumb and index finger since the accident.",
    },
    {
      ...base, f: F2, p: 2, q: 6, date: "2026-04-09", date_text: "04/09/2026",
      provider_name: "Dr. Ravi Patel, MD", facility: "Summit Orthopedic Specialists", specialty: "Orthopedic Surgery",
      encounter_type: "office_visit", chief_complaint: "Neck pain radiating to right arm",
      diagnoses: ["C5-C6 disc herniation with radiculopathy"], icd10_codes: ["M50.121"], cpt_codes: ["99204"],
      findings: "Reviewed MRI from Valley Imaging (04/02/2026): C5-C6 right paracentral herniation contacting the exiting C6 nerve root.",
      plan: "Physical therapy 3x/week for 6 weeks. EMG/NCS with Dr. Jenna Lee. Consider ESI if no improvement.", pain_score: 7,
      significance: "high", quote: "Within a reasonable degree of medical probability, the herniation is causally related to the 03/14/2026 collision.",
    },
    {
      ...base, f: F2, p: 9, date: "2026-04-13", date_text: "4/13/26", provider_name: "Maya Chen, DPT", facility: "MoveWell Physical Therapy",
      specialty: "Physical Therapy", encounter_type: "therapy", chief_complaint: "PT initial evaluation — cervical radiculopathy",
      diagnoses: ["Cervical radiculopathy"], procedures: ["PT evaluation", "Manual therapy"], cpt_codes: ["97162", "97140"],
      findings: "Cervical rotation 45° R / 60° L. Grip strength R 28 kg vs L 41 kg.", plan: "3x/week x 6 weeks", pain_score: 6,
      significance: "medium", quote: "Patient unable to turn head to check blind spot while driving.",
    },
    {
      ...base, f: F2, p: 14, date: "2026-04-27", date_text: "4/27/26", provider_name: "Maya Chen, DPT", facility: "MoveWell Physical Therapy",
      specialty: "Physical Therapy", encounter_type: "therapy", chief_complaint: "PT visit 6", diagnoses: ["Cervical radiculopathy"],
      procedures: ["Therapeutic exercise", "Manual therapy"], cpt_codes: ["97110", "97140"], findings: "Rotation improved to 55° R.",
      plan: "Continue plan", pain_score: 4, significance: "low", quote: "Reports sleeping through the night for first time since accident.",
    },
    {
      ...base, f: F2, p: 19, date: "2026-05-15", date_text: "5/15/26", provider_name: "Maya Chen, DPT", facility: "MoveWell Physical Therapy",
      specialty: "Physical Therapy", encounter_type: "therapy", chief_complaint: "PT visit 12", diagnoses: ["Cervical radiculopathy"],
      procedures: ["Therapeutic exercise"], cpt_codes: ["97110"], findings: "Plateaued. Persistent R grip deficit.",
      plan: "Recommend return to orthopedics for injection consideration.", pain_score: 4, significance: "medium",
      quote: "Patient states she must stop PT due to childcare and cost of copays.",
    },
    {
      ...base, f: F2, p: 23, q: 25, date: "2026-08-21", date_text: "08/21/2026", provider_name: "Dr. Ravi Patel, MD",
      facility: "Summit Orthopedic Specialists", specialty: "Orthopedic Surgery", encounter_type: "office_visit",
      chief_complaint: "Worsening neck pain and right arm numbness", diagnoses: ["C5-C6 disc herniation with radiculopathy"], cpt_codes: ["99214"],
      findings: "Weakness R wrist extension 4/5. Symptoms worse after lifting at work.", plan: "Cervical ESI at C5-C6. Discussed ACDF if ESI fails.",
      pain_score: 8, work_status: "No lifting > 10 lbs", significance: "high",
      quote: "Patient was unable to continue treatment May–August due to financial reasons.",
    },
    {
      ...base, f: F2, p: 28, q: 29, date: "2026-09-04", date_text: "09/04/2026", provider_name: "Dr. Ravi Patel, MD",
      facility: "Summit Orthopedic Specialists", specialty: "Orthopedic Surgery", encounter_type: "surgery",
      chief_complaint: "Cervical epidural steroid injection", diagnoses: ["C5-C6 disc herniation with radiculopathy"],
      procedures: ["Interlaminar cervical epidural steroid injection, fluoroscopic guidance"], cpt_codes: ["62321"],
      findings: "Procedure tolerated without complication.", plan: "Follow up 4 weeks.", pain_score: 8, significance: "high",
      quote: "Pre-procedure pain 8/10; post-procedure 3/10.",
    },
    {
      ...base, f: F1, p: 31, date: null, date_text: "[date illegible]", provider_name: "Dr. Kevin Osei, DO", facility: "Brookline Family Medicine",
      specialty: "Primary Care", encounter_type: "pharmacy", chief_complaint: "Medication refill request", diagnoses: [], medications: ["Gabapentin 300 mg"],
      findings: "", plan: "Refill x1", significance: "low", quote: "Refill gabapentin per patient call.",
    },
  ] as E[]
).map(enc);

type B = Omit<Bill, "id" | "source"> & { p: number };
const bills: Bill[] = (
  [
    { p: 2, date: "2026-03-14", provider_name: "Riverside General Hospital", facility: "Riverside General Hospital ED", description: "ED visit, high severity", cpt_code: "99284", amount_charged: 2850, amount_paid: 1140 },
    { p: 2, date: "2026-03-14", provider_name: "Riverside General Hospital", facility: "Riverside General Hospital ED", description: "CT cervical spine w/o contrast", cpt_code: "72125", amount_charged: 3420, amount_paid: 1210 },
    { p: 3, date: "2026-03-19", provider_name: "Dr. Kevin Osei, DO", facility: "Brookline Family Medicine", description: "Office visit est. moderate", cpt_code: "99214", amount_charged: 265, amount_paid: 142 },
    { p: 4, date: "2026-04-02", provider_name: "Valley Imaging Center", facility: "Valley Imaging Center", description: "MRI cervical spine w/o contrast", cpt_code: "72141", amount_charged: 2400, amount_paid: null },
    { p: 5, date: "2026-04-09", provider_name: "Dr. Ravi Patel, MD", facility: "Summit Orthopedic Specialists", description: "New patient visit, high", cpt_code: "99204", amount_charged: 545, amount_paid: 260 },
    { p: 6, date: "2026-04-13", provider_name: "MoveWell Physical Therapy", facility: "MoveWell Physical Therapy", description: "PT evaluation moderate complexity", cpt_code: "97162", amount_charged: 310, amount_paid: 120 },
    { p: 6, date: "2026-04-27", provider_name: "MoveWell Physical Therapy", facility: "MoveWell Physical Therapy", description: "Therapeutic exercise 15 min x2", cpt_code: "97110", amount_charged: 220, amount_paid: 88 },
    { p: 7, date: "2026-04-27", provider_name: "MoveWell Physical Therapy", facility: "MoveWell Physical Therapy", description: "Therapeutic exercise 15 min x2", cpt_code: "97110", amount_charged: 220, amount_paid: 0 },
    { p: 7, date: "2026-05-15", provider_name: "MoveWell Physical Therapy", facility: "MoveWell Physical Therapy", description: "Therapeutic exercise 15 min x2", cpt_code: "97110", amount_charged: 220, amount_paid: 88 },
    { p: 8, date: "2026-08-21", provider_name: "Dr. Ravi Patel, MD", facility: "Summit Orthopedic Specialists", description: "Office visit est. moderate", cpt_code: "99214", amount_charged: 330, amount_paid: null },
    { p: 9, date: "2026-09-04", provider_name: "Summit Orthopedic Specialists", facility: "Summit Orthopedic Specialists", description: "Cervical ESI with fluoroscopy", cpt_code: "62321", amount_charged: 4150, amount_paid: null },
  ] as B[]
).map(({ p, ...b }, i) => ({ ...b, id: `demo_bill_${i}`, source: { file: F3, page_start: p, page_end: p } }));

export const DEMO_CASE: CaseExtraction = {
  case_name: "Demo — Rivera v. Coastal Freight (MVC)",
  files: [
    { name: F1, pages: 412 },
    { name: F2, pages: 286 },
    { name: F3, pages: 24 },
  ],
  patient_name: "Elena Rivera",
  patient_dob: "1988-06-02",
  incident_date: "2026-03-14",
  incident_description: "Rear-end motor vehicle collision; patient was the restrained driver, stopped at a red light.",
  encounters,
  bills,
  referenced_records: [
    { id: "demo_ref_1", provider_name: "Valley Imaging Center", record_type: "MRI cervical spine report", date_text: "04/02/2026", date: "2026-04-02", reason: "MRI cervical spine ordered by PCP and reviewed by Dr. Patel; the radiology report itself is not in the file", source: { file: F2, page_start: 3, page_end: 3 } },
    { id: "demo_ref_2", provider_name: "Dr. Jenna Lee", record_type: "EMG/NCS study", date_text: "", date: null, reason: "Dr. Patel ordered EMG/NCS with Dr. Jenna Lee", source: { file: F2, page_start: 5, page_end: 5 } },
    { id: "demo_ref_3", provider_name: "Harbor Chiropractic", record_type: "Prior chiropractic records", date_text: "2023", date: null, reason: "ER note: 'history of chiropractic care for low back pain in 2023 at Harbor Chiropractic'", source: { file: F1, page_start: 4, page_end: 4 } },
    { id: "demo_ref_4", provider_name: "MoveWell Physical Therapy", record_type: "PT visit notes", date_text: "4/13/26", date: "2026-04-13", reason: "PT evaluation referenced", source: { file: F2, page_start: 8, page_end: 8 } },
  ],
  prior_conditions: [
    { id: "demo_prior_1", condition: "Prior low back pain treated with chiropractic care (2023)", evidence: "history of chiropractic care for low back pain in 2023 at Harbor Chiropractic", source: { file: F1, page_start: 4, page_end: 4 } },
  ],
  warnings: [],
};
