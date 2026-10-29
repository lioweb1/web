"use client";
import Papa from "papaparse";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Upload } from "lucide-react";
import { Field, Input, Select, Checkbox } from "@/components/ui/input";
import { SubmitButton, FormMessage } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";
import type { ActionState } from "@/lib/action-types";

const FIELDS: { key: string; label: string; required?: boolean; re: RegExp }[] = [
  { key: "name", label: "Business name", required: true, re: /^(business|company|organi[sz]ation)?\s*name$|^company$|^business$/i },
  { key: "website", label: "Website", re: /web|url|site|domain/i },
  { key: "email", label: "Email", re: /e-?mail/i },
  { key: "phone", label: "Phone", re: /phone|tel|mobile/i },
  { key: "city", label: "City", re: /city|town|locality/i },
  { key: "country", label: "Country", re: /country/i },
  { key: "industry", label: "Industry", re: /industry|sector/i },
  { key: "category", label: "Category", re: /category|type/i },
  { key: "notes", label: "Notes", re: /note|comment|description/i },
  { key: "tags", label: "Tags", re: /tag|label/i },
];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

type Result = { total: number; created: number; duplicates: number; invalid: number; errors: { row: number; message: string }[]; limitReached: boolean };

export function ImportWizard({ action }: { action: (p: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, act] = useActionState(action, null);
  const [csv, setCsv] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const onFile = async (file: File | undefined) => {
    setFileError(null);
    setCsv("");
    if (!file) return;
    if (file.size > MAX_BYTES) return setFileError("File is larger than 5 MB.");
    const text = await file.text();
    const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    const hs = (res.meta.fields ?? []).filter(Boolean);
    if (!hs.length) return setFileError("Could not find a header row. The first line must contain column names.");
    if (res.data.length > MAX_ROWS) return setFileError(`File has ${res.data.length} rows; the maximum is ${MAX_ROWS}. Split it into smaller files.`);
    const m: Record<string, string> = {};
    for (const f of FIELDS) {
      const h = hs.find((x) => f.re.test(x) && !Object.values(m).includes(x));
      if (h) m[f.key] = h;
    }
    setHeaders(hs);
    setPreview(res.data.slice(0, 5));
    setRowCount(res.data.length);
    setMapping(m);
    setCsv(text);
  };

  const result = (state?.data as { result?: Result } | undefined)?.result;

  return (
    <div className="space-y-6">
      <Field label="CSV file" htmlFor="file" hint="UTF-8 CSV with a header row. Max 5,000 rows / 5 MB.">
        <label htmlFor="file" className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2/40 px-4 py-8 text-sm text-muted hover:bg-surface-2">
          <Upload className="size-4" /> Choose a CSV file
          <input id="file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </Field>
      {fileError ? <ErrorState title="Can't use this file" description={fileError} /> : null}

      {csv ? (
        <form action={act} className="space-y-6">
          <input type="hidden" name="csv" value={csv} />
          <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
          <div>
            <h2 className="mb-1 text-sm font-semibold">Map columns</h2>
            <p className="mb-3 text-xs text-muted">{rowCount.toLocaleString()} rows detected. Only Business name is required.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} htmlFor={`map-${f.key}`}>
                  <Select id={`map-${f.key}`} value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))} required={f.required}>
                    <option value="">— Not imported —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">Preview (first 5 rows)</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2/60 text-left text-xs text-muted">
                  <tr>
                    {FIELDS.filter((f) => mapping[f.key]).map((f) => (
                      <th key={f.key} className="px-3 py-2 font-medium">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      {FIELDS.filter((f) => mapping[f.key]).map((f) => (
                        <td key={f.key} className="max-w-56 truncate px-3 py-2">
                          {r[mapping[f.key]] || <span className="text-subtle">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tags for all imported leads (optional)" htmlFor="tags" hint="Comma separated, e.g. imported, conference-2026">
              <Input id="tags" name="tags" maxLength={300} />
            </Field>
            <div className="flex items-end">
              <Checkbox name="enrich" defaultChecked label="Analyze websites, check domains and emails after import (background)" />
            </div>
          </div>
          <p className="text-xs text-muted">Imported records are private to this workspace. Duplicates (same domain, or same name + country + city) are skipped. Only import data you are permitted to use.</p>
          <FormMessage state={state} />
          <div className="flex items-center gap-3">
            <SubmitButton disabled={!mapping.name} pendingText="Importing…">
              Import {rowCount.toLocaleString()} rows
            </SubmitButton>
            {result ? (
              <Link href="/app/leads?sort=-created" className="text-sm text-accent hover:underline">
                View imported leads
              </Link>
            ) : null}
          </div>
          {result && result.errors.length ? (
            <div className="rounded-lg border border-border">
              <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted">Row messages ({result.errors.length})</p>
              <ul className="max-h-60 overflow-y-auto text-xs">
                {result.errors.slice(0, 200).map((e, i) => (
                  <li key={i} className="border-b border-border px-3 py-1.5 last:border-0">
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
