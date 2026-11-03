import type { CaseExtraction, ChunkExtraction, SourceRef } from "./schema";

/** Result of one chunk, with the offset needed to turn relative pages into absolute ones. */
export type ChunkResult = { file: string; firstPage: number; lastPage: number; data: ChunkExtraction };

let counter = 0;
const id = (p: string) => `${p}_${(++counter).toString(36)}`;

function clampPage(rel: number, r: ChunkResult): number {
  const abs = r.firstPage + Math.max(1, Math.round(rel)) - 1;
  return Math.min(Math.max(abs, r.firstPage), r.lastPage);
}

function ref(r: ChunkResult, start: number, end = start): SourceRef {
  const a = clampPage(start, r);
  return { file: r.file, page_start: a, page_end: Math.max(a, clampPage(end, r)) };
}

const firstNonEmpty = (vals: (string | null)[]) => vals.find((v) => v && v.trim()) ?? null;

/** Most common non-empty value; ties go to the earliest. */
function mode(vals: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of vals) if (v && v.trim()) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

export function mergeChunks(caseName: string, files: { name: string; pages: number }[], results: ChunkResult[], warnings: string[] = []): CaseExtraction {
  const out: CaseExtraction = {
    case_name: caseName,
    files,
    patient_name: mode(results.map((r) => r.data.patient_name)),
    patient_dob: mode(results.map((r) => r.data.patient_dob)),
    // The earliest stated incident date is usually the date of loss.
    incident_date: results.map((r) => r.data.incident_date).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()[0] ?? null,
    incident_description: firstNonEmpty(results.map((r) => r.data.incident_description)),
    encounters: [],
    bills: [],
    referenced_records: [],
    prior_conditions: [],
    warnings,
  };
  for (const r of results) {
    for (const { page_start, page_end, ...e } of r.data.encounters) out.encounters.push({ ...e, id: id("enc"), source: ref(r, page_start, page_end) });
    for (const { page, ...b } of r.data.bills) out.bills.push({ ...b, id: id("bill"), source: ref(r, page) });
    for (const { page, ...x } of r.data.referenced_records) out.referenced_records.push({ ...x, id: id("ref"), source: ref(r, page) });
    for (const { page, ...c } of r.data.prior_conditions) out.prior_conditions.push({ ...c, id: id("prior"), source: ref(r, page) });
  }
  // A visit split across a chunk boundary shows up twice: same date + provider, adjacent pages.
  out.encounters = out.encounters.filter((e, i, all) => {
    const twin = all.findIndex(
      (o) => o.date === e.date && o.date !== null && o.provider_name === e.provider_name && o.source.file === e.source.file && Math.abs(o.source.page_end - e.source.page_start) <= 1,
    );
    if (twin === -1 || twin >= i) return true;
    const keep = all[twin];
    keep.source.page_end = Math.max(keep.source.page_end, e.source.page_end);
    keep.diagnoses = [...new Set([...keep.diagnoses, ...e.diagnoses])];
    keep.procedures = [...new Set([...keep.procedures, ...e.procedures])];
    keep.medications = [...new Set([...keep.medications, ...e.medications])];
    if (e.significance === "high") keep.significance = "high";
    return false;
  });
  return out;
}
