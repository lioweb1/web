"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Select } from "@/components/ui/input";
import { ErrorState, Notice } from "@/components/ui/states";

export function ExportBuilder({ query, fields, matching }: { query: string; fields: { key: string; label: string; default?: boolean }[]; matching: number }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(fields.filter((f) => f.default).map((f) => f.key));
  const [format, setFormat] = useState("excel");
  const [delimiter, setDelimiter] = useState(",");
  const [contact, setContact] = useState("any");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const p = new URLSearchParams(query);
      p.set("fields", selected.join(","));
      p.set("format", format);
      p.set("delimiter", delimiter);
      p.set("contact", contact);
      const res = await fetch(`/api/leads/export?${p}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "leads.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setDone(`Downloaded ${name}.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Format" htmlFor="format">
          <Select id="format" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="excel">Excel-compatible CSV (UTF-8 with BOM)</option>
            <option value="csv">Plain CSV (UTF-8)</option>
          </Select>
        </Field>
        <Field label="Delimiter" htmlFor="delimiter" hint="Use semicolon for Excel in locales with comma decimals.">
          <Select id="delimiter" value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
            <option value=",">Comma ( , )</option>
            <option value=";">Semicolon ( ; )</option>
          </Select>
        </Field>
        <Field label="Contact availability" htmlFor="contact">
          <Select id="contact" value={contact} onChange={(e) => setContact(e.target.value)}>
            <option value="any">All leads</option>
            <option value="email">Only with a business email</option>
            <option value="phone">Only with a phone number</option>
            <option value="email_or_phone">With email or phone</option>
          </Select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 flex w-full items-center justify-between text-sm font-medium">
          Fields ({selected.length})
          <span className="flex gap-3 text-xs font-normal">
            <button type="button" className="text-accent hover:underline" onClick={() => setSelected(fields.map((f) => f.key))}>
              All
            </button>
            <button type="button" className="text-accent hover:underline" onClick={() => setSelected(fields.filter((f) => f.default).map((f) => f.key))}>
              Defaults
            </button>
            <button type="button" className="text-accent hover:underline" onClick={() => setSelected([])}>
              None
            </button>
          </span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f) => (
            <Checkbox key={f.key} label={f.label} checked={selected.includes(f.key)} onChange={() => setSelected((s) => (s.includes(f.key) ? s.filter((x) => x !== f.key) : [...s, f.key]))} />
          ))}
        </div>
      </fieldset>
      {error ? <ErrorState title="Export failed" description={error} /> : null}
      {done ? <Notice tone="success">{done}</Notice> : null}
      <Button variant="primary" onClick={run} disabled={busy || !selected.length || matching === 0}>
        {busy ? <Loader2 className="animate-spin" /> : <Download />} Export {matching.toLocaleString()} lead{matching === 1 ? "" : "s"}
      </Button>
      <p className="text-xs text-muted">Exports contain only records stored in your workspace. Cells that could be interpreted as spreadsheet formulas are escaped. Respect privacy and anti-spam laws when contacting businesses.</p>
    </div>
  );
}
