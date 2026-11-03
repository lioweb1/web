"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle, CalendarClock, Download, FileJson, FileSearch, FileText, FolderOpen, Gauge, ListOrdered, Loader2, Mail, Receipt, Settings2, Sparkles, Upload, X,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { analyzeCase, type CaseAnalysis, type RedFlag } from "@/lib/analyze";
import { DEMO_CASE } from "@/lib/demo";
import { DEFAULT_FIRM, recordsRequestLetter, type FirmInfo } from "@/lib/letters";
import type { CaseExtraction, Encounter, SourceRef } from "@/lib/schema";

type Tab = "overview" | "chronology" | "gaps" | "missing" | "billing";
type Progress = { done: number; total: number; label: string };

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function download(name: string, data: Blob | string, type = "text/plain") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "case";

export function Workspace() {
  const params = useSearchParams();
  const [caseData, setCaseData] = useState<CaseExtraction | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [gapDays, setGapDays] = useState(30);
  const [firm, setFirm] = useState<FirmInfo>(DEFAULT_FIRM);
  const [showSettings, setShowSettings] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [caseName, setCaseName] = useState("");
  const fileUrls = useRef(new Map<string, string>());
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((s) => setLive(Boolean(s.live))).catch(() => setLive(false));
    try {
      const f = localStorage.getItem("medchrono.firm");
      if (f) setFirm({ ...DEFAULT_FIRM, ...JSON.parse(f) });
    } catch {}
  }, []);
  useEffect(() => {
    if (params.get("demo") === "1") setCaseData(DEMO_CASE);
  }, [params]);
  useEffect(() => {
    try {
      localStorage.setItem("medchrono.firm", JSON.stringify(firm));
    } catch {}
  }, [firm]);

  const analysis = useMemo(() => (caseData ? analyzeCase(caseData, { gapDays }) : null), [caseData, gapDays]);

  /** Opens the uploaded PDF at the cited page (browser PDF viewers honour #page=N). */
  const openSource = (s: { file: string; page_start: number }) => {
    const url = fileUrls.current.get(s.file);
    if (url) window.open(`${url}#page=${s.page_start}`, "_blank", "noopener");
  };
  const canOpen = (file: string) => fileUrls.current.has(file);

  async function run() {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setWarnings([]);
    setProgress({ done: 0, total: 0, label: "Uploading" });
    fileUrls.current.forEach((u) => URL.revokeObjectURL(u));
    fileUrls.current.clear();
    for (const f of files) fileUrls.current.set(f.name, URL.createObjectURL(f));

    const form = new FormData();
    form.set("case_name", caseName || files[0].name.replace(/\.pdf$/i, ""));
    files.forEach((f) => form.append("files", f));
    abort.current = new AbortController();
    try {
      const res = await fetch("/api/analyze", { method: "POST", body: form, signal: abort.current.signal });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "progress") setProgress(ev);
          else if (ev.type === "warning") setWarnings((w) => [...w, ev.message]);
          else if (ev.type === "error") throw new Error(ev.message);
          else if (ev.type === "result") {
            setCaseData(ev.extraction);
            setTab("overview");
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function openCaseFile(f: File) {
    f.text()
      .then((t) => {
        const x = JSON.parse(t) as CaseExtraction;
        if (!Array.isArray(x.encounters)) throw new Error();
        setCaseData(x);
        setTab("overview");
      })
      .catch(() => setError("That file is not a MedChrono case file."));
  }

  async function exportDocx() {
    if (!caseData || !analysis) return;
    const { buildDocx } = await import("@/lib/report");
    download(`${safeName(caseData.case_name)}_chronology.docx`, await buildDocx(caseData, analysis, firm));
  }
  async function exportCsv(kind: "chronology" | "billing") {
    if (!caseData || !analysis) return;
    const r = await import("@/lib/report");
    const csv = kind === "chronology" ? r.chronologyCsv(analysis) : r.billingCsv(caseData);
    download(`${safeName(caseData.case_name)}_${kind}.csv`, csv, "text/csv");
  }

  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Logo />
          <div className="flex items-center gap-2 text-sm">
            {live !== null && (
              <span className={`hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline ${live ? "bg-teal-soft text-teal" : "bg-warn-soft text-warn"}`}>
                {live ? "AI connected" : "Demo mode — add ANTHROPIC_API_KEY to analyze real files"}
              </span>
            )}
            <button onClick={() => setShowSettings(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:border-navy">
              <Settings2 className="h-4 w-4" /> Settings
            </button>
            {caseData && (
              <button onClick={() => { setCaseData(null); setFiles([]); }} className="whitespace-nowrap rounded-lg bg-navy px-3 py-1.5 font-medium text-white">
                New case
              </button>
            )}
          </div>
        </div>
      </header>

      {!caseData ? (
        <UploadPanel
          live={live}
          busy={busy}
          progress={progress}
          warnings={warnings}
          error={error}
          files={files}
          setFiles={setFiles}
          caseName={caseName}
          setCaseName={setCaseName}
          onRun={run}
          onCancel={() => abort.current?.abort()}
          onDemo={() => setCaseData(DEMO_CASE)}
          onOpenCase={openCaseFile}
        />
      ) : (
        analysis && (
          <main className="mx-auto max-w-7xl px-4 py-6">
            <CaseHeader x={caseData} a={analysis} />
            <div className="no-print mt-5 flex flex-wrap items-center justify-between gap-3">
              <nav className="flex flex-wrap gap-1 rounded-xl border border-line bg-white p-1 text-sm">
                {(
                  [
                    ["overview", "Overview", Gauge, analysis.red_flags.length],
                    ["chronology", "Chronology", ListOrdered, analysis.chronology.length + analysis.undated.length],
                    ["gaps", "Treatment gaps", CalendarClock, analysis.gaps.length],
                    ["missing", "Missing records", FileSearch, analysis.missing_records.length],
                    ["billing", "Medical specials", Receipt, analysis.billing_issues.filter((b) => b.severity !== "low").length],
                  ] as const
                ).map(([k, label, Icon, n]) => (
                  <button key={k} onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${tab === k ? "bg-navy text-white" : "text-muted hover:text-ink"}`}>
                    <Icon className="h-4 w-4" /> {label}
                    <span className={`rounded-full px-1.5 text-[11px] ${tab === k ? "bg-white/20" : "bg-paper"}`}>{n}</span>
                  </button>
                ))}
              </nav>
              <div className="flex flex-wrap gap-2 text-sm">
                <button onClick={exportDocx} className="inline-flex items-center gap-1.5 rounded-lg bg-teal px-3 py-2 font-medium text-white">
                  <FileText className="h-4 w-4" /> Word report
                </button>
                <button onClick={() => exportCsv("chronology")} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2">
                  <Download className="h-4 w-4" /> CSV
                </button>
                <button
                  onClick={() => download(`${safeName(caseData.case_name)}.medchrono.json`, JSON.stringify(caseData, null, 2), "application/json")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2"
                  title="Save the case to your computer and reopen it later. Nothing is stored on the server."
                >
                  <FileJson className="h-4 w-4" /> Save case
                </button>
              </div>
            </div>
            {caseData.warnings.length > 0 && (
              <div className="mt-4 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
                {caseData.warnings.map((w) => (
                  <div key={w}>⚠ {w}</div>
                ))}
              </div>
            )}
            <div className="mt-5">
              {tab === "overview" && <Overview a={analysis} gapDays={gapDays} openSource={openSource} canOpen={canOpen} />}
              {tab === "chronology" && <Chronology a={analysis} openSource={openSource} canOpen={canOpen} />}
              {tab === "gaps" && <Gaps a={analysis} gapDays={gapDays} setGapDays={setGapDays} />}
              {tab === "missing" && <Missing x={caseData} a={analysis} firm={firm} openSource={openSource} canOpen={canOpen} />}
              {tab === "billing" && <Billing a={analysis} onCsv={() => exportCsv("billing")} openSource={openSource} canOpen={canOpen} />}
            </div>
            <p className="mt-10 text-center text-xs text-muted">AI-assisted review. Verify every entry against the cited page before relying on it.</p>
          </main>
        )
      )}

      {showSettings && <SettingsDialog firm={firm} setFirm={setFirm} gapDays={gapDays} setGapDays={setGapDays} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function UploadPanel(props: {
  live: boolean | null; busy: boolean; progress: Progress | null; warnings: string[]; error: string | null;
  files: File[]; setFiles: (f: File[]) => void; caseName: string; setCaseName: (s: string) => void;
  onRun: () => void; onCancel: () => void; onDemo: () => void; onOpenCase: (f: File) => void;
}) {
  const { live, busy, progress, files, setFiles } = props;
  const [drag, setDrag] = useState(false);
  const add = (list: FileList | null) => {
    if (!list) return;
    const pdfs = [...list].filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    const names = new Set(files.map((f) => f.name));
    setFiles([...files, ...pdfs.filter((f) => !names.has(f.name))]);
  };
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-serif text-3xl font-bold">New case review</h1>
      <p className="mt-2 text-muted">Upload every medical and billing record for the case. Files are processed in memory and never stored.</p>

      <input
        value={props.caseName}
        onChange={(e) => props.setCaseName(e.target.value)}
        placeholder="Case name (e.g. Rivera v. Coastal Freight)"
        className="mt-6 w-full rounded-lg border border-line bg-white px-3 py-2.5 outline-none focus:border-navy"
        disabled={busy}
      />

      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-white px-6 py-12 text-center transition ${drag ? "border-teal bg-teal-soft" : "border-line hover:border-navy"} ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <Upload className="h-8 w-8 text-teal" />
        <div className="mt-3 font-medium">Drop PDFs here or click to browse</div>
        <div className="text-sm text-muted">ER, hospital, imaging, PT, chiropractic, billing ledgers — scanned or digital</div>
        <input type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => add(e.target.files)} />
      </label>

      {files.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-white text-sm">
          {files.map((f) => (
            <li key={f.name} className="flex items-center justify-between px-4 py-2.5">
              <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted" /> {f.name}</span>
              <span className="flex items-center gap-3 text-muted">
                {(f.size / 1024 / 1024).toFixed(1)} MB
                {!busy && <button onClick={() => setFiles(files.filter((x) => x !== f))} aria-label={`Remove ${f.name}`}><X className="h-4 w-4" /></button>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {busy && progress && (
        <div className="mt-6 rounded-xl border border-line bg-white p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-teal" /> {progress.label}</span>
            <span className="text-muted">{progress.total ? `${progress.done}/${progress.total} sections · ${pct}%` : "Preparing…"}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper"><div className="h-full bg-teal transition-all" style={{ width: `${pct}%` }} /></div>
          <button onClick={props.onCancel} className="mt-3 text-sm text-danger">Cancel</button>
        </div>
      )}
      {props.warnings.length > 0 && <div className="mt-4 space-y-1 text-sm text-warn">{props.warnings.map((w) => <div key={w}>⚠ {w}</div>)}</div>}
      {props.error && <div className="mt-4 rounded-lg bg-danger-soft p-3 text-sm text-danger">{props.error}</div>}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={props.onRun}
          disabled={busy || files.length === 0 || live === false}
          className="inline-flex items-center gap-2 rounded-lg bg-navy px-5 py-2.5 font-medium text-white disabled:opacity-40"
          title={live === false ? "Add ANTHROPIC_API_KEY on the server to analyze real files" : undefined}
        >
          <Sparkles className="h-4 w-4" /> Build chronology
        </button>
        <button onClick={props.onDemo} disabled={busy} className="rounded-lg border border-line bg-white px-5 py-2.5 font-medium hover:border-navy">
          Load demo case
        </button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-muted hover:text-ink">
          <FolderOpen className="h-4 w-4" /> Open saved case
          <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && props.onOpenCase(e.target.files[0])} />
        </label>
      </div>
    </main>
  );
}

function CaseHeader({ x, a }: { x: CaseExtraction; a: CaseAnalysis }) {
  const s = a.case_strength.score;
  const tone = s >= 80 ? "text-teal" : s >= 60 ? "text-warn" : "text-danger";
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_auto]">
      <div>
        <h1 className="font-serif text-2xl font-bold md:text-3xl">{x.case_name}</h1>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          <span>Patient: <b className="text-ink">{x.patient_name ?? "—"}</b></span>
          <span>DOB: {x.patient_dob ?? "—"}</span>
          <span>Date of incident: <b className="text-ink">{x.incident_date ?? "not stated"}</b></span>
          <span>{x.files.length} files · {a.totals.pages.toLocaleString()} pages</span>
        </div>
        {x.incident_description && <p className="mt-2 max-w-3xl text-sm">{x.incident_description}</p>}
      </div>
      <div className="grid grid-cols-3 gap-3 text-center md:w-[420px]">
        <Stat label="Documentation" value={<span className={tone}>{s}<span className="text-base text-muted">/100</span></span>} />
        <Stat label="Total billed" value={usd(a.totals.billed).replace(/\.\d\d$/, "")} />
        <Stat label="Review time saved" value={`${a.hours_saved}h`} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-3">
      <div className="font-serif text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function Cite({ s, openSource, canOpen }: { s: SourceRef | { file: string; page_start: number; page_end?: number }; openSource: (s: { file: string; page_start: number }) => void; canOpen: (f: string) => boolean }) {
  const label = `${s.file.replace(/\.pdf$/i, "")} · p.${s.page_start}${s.page_end && s.page_end > s.page_start ? `–${s.page_end}` : ""}`;
  return canOpen(s.file) ? (
    <button onClick={() => openSource(s)} className="whitespace-nowrap text-xs font-medium text-teal underline decoration-dotted underline-offset-2">{label}</button>
  ) : (
    <span className="whitespace-nowrap text-xs text-muted">{label}</span>
  );
}

const sevStyle: Record<RedFlag["severity"], string> = {
  high: "bg-danger-soft text-danger",
  medium: "bg-warn-soft text-warn",
  low: "bg-paper text-muted",
};

type SrcProps = { openSource: (s: { file: string; page_start: number }) => void; canOpen: (f: string) => boolean };

function Overview({ a, gapDays, ...src }: { a: CaseAnalysis; gapDays: number } & SrcProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
      <section className="min-w-0 rounded-2xl border border-line bg-white p-5">
        <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-5 w-5 text-danger" /> Red flags & defense risks</h2>
        {a.red_flags.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No red flags found.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {a.red_flags.map((f, i) => (
              <li key={i} className="flex flex-wrap gap-3 rounded-xl border border-line p-3 sm:flex-nowrap">
                <span className={`h-fit rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase ${sevStyle[f.severity]}`}>{f.severity}</span>
                <div className="min-w-0 flex-1 basis-48">
                  <div className="font-medium">{f.title}</div>
                  <div className="text-sm text-muted">{f.detail}</div>
                </div>
                {f.file && f.page && <Cite s={{ file: f.file, page_start: f.page }} {...src} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      <aside className="space-y-5">
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="font-semibold">Documentation strength</h2>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper">
            <div className={`h-full ${a.case_strength.score >= 80 ? "bg-teal" : a.case_strength.score >= 60 ? "bg-warn" : "bg-danger"}`} style={{ width: `${a.case_strength.score}%` }} />
          </div>
          <div className="mt-2 text-sm font-medium">{a.case_strength.label}</div>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            {a.case_strength.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </section>
        <section className="rounded-2xl border border-line bg-white p-5 text-sm">
          <h2 className="font-semibold">At a glance</h2>
          <dl className="mt-3 grid grid-cols-2 gap-y-2">
            <dt className="text-muted">Encounters</dt><dd className="text-right font-medium">{a.totals.visits}</dd>
            <dt className="text-muted">Providers</dt><dd className="text-right font-medium">{a.providers.length}</dd>
            <dt className="text-muted">Gaps &gt; {gapDays} days</dt><dd className="text-right font-medium">{a.gaps.length}</dd>
            <dt className="text-muted">Missing records</dt><dd className="text-right font-medium">{a.missing_records.length}</dd>
            <dt className="text-muted">Billed</dt><dd className="text-right font-medium">{usd(a.totals.billed)}</dd>
            <dt className="text-muted">Paid / adjusted</dt><dd className="text-right font-medium">{usd(a.totals.paid)}</dd>
            <dt className="text-muted">Possible duplicates</dt><dd className="text-right font-medium text-danger">{usd(a.totals.duplicate_amount)}</dd>
          </dl>
        </section>
      </aside>
    </div>
  );
}

const TYPE_LABEL: Record<Encounter["encounter_type"], string> = {
  office_visit: "Office visit", emergency: "Emergency", hospital_admission: "Admission", surgery: "Procedure / surgery", imaging: "Imaging",
  lab: "Lab", therapy: "Therapy", pharmacy: "Pharmacy", telehealth: "Telehealth", other: "Other",
};

function Chronology({ a, ...src }: { a: CaseAnalysis } & SrcProps) {
  const [q, setQ] = useState("");
  const [onlyKey, setOnlyKey] = useState(false);
  const rows = [...a.chronology, ...a.undated].filter((e) => {
    if (onlyKey && e.significance !== "high") return false;
    if (!q) return true;
    const hay = [e.provider_name, e.facility, e.specialty, e.chief_complaint, e.findings, e.plan, ...e.diagnoses, ...e.procedures, ...e.icd10_codes, ...e.cpt_codes].join(" ").toLowerCase();
    return hay.includes(q.toLowerCase());
  });
  return (
    <section className="rounded-2xl border border-line bg-white">
      <div className="no-print flex flex-wrap items-center gap-3 border-b border-line p-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search diagnosis, provider, CPT, ICD-10…" className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-navy" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyKey} onChange={(e) => setOnlyKey(e.target.checked)} className="accent-teal" /> Key events only
        </label>
      </div>
      <ol className="divide-y divide-line">
        {rows.map((e) => (
          <li key={e.id} className="grid gap-3 p-4 md:grid-cols-[130px_1fr_auto]">
            <div>
              <div className="font-semibold">{e.date ?? <span className="text-warn">{e.date_text || "Undated"}</span>}</div>
              <div className="mt-1 inline-block rounded bg-paper px-1.5 py-0.5 text-[11px] text-muted">{TYPE_LABEL[e.encounter_type]}</div>
              {e.significance === "high" && <div className="mt-1 text-[11px] font-semibold uppercase text-danger">Key event</div>}
            </div>
            <div className="min-w-0 text-sm">
              <div className="font-medium">{e.provider_name || "Unknown provider"} <span className="font-normal text-muted">· {e.facility}{e.specialty ? ` · ${e.specialty}` : ""}</span></div>
              {e.chief_complaint && <div className="mt-1">{e.chief_complaint}</div>}
              {e.diagnoses.length > 0 && <div className="mt-1"><b>Dx:</b> {e.diagnoses.join("; ")} {e.icd10_codes.length > 0 && <span className="text-muted">({e.icd10_codes.join(", ")})</span>}</div>}
              {e.procedures.length > 0 && <div><b>Procedures:</b> {e.procedures.join("; ")} {e.cpt_codes.length > 0 && <span className="text-muted">({e.cpt_codes.join(", ")})</span>}</div>}
              {e.findings && <div><b>Findings:</b> {e.findings}</div>}
              {e.plan && <div><b>Plan:</b> {e.plan}</div>}
              {e.medications.length > 0 && <div><b>Meds:</b> {e.medications.join("; ")}</div>}
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
                {e.pain_score !== null && <span>Pain {e.pain_score}/10</span>}
                {e.work_status && <span>Work: {e.work_status}</span>}
              </div>
              {e.quote && <blockquote className="mt-2 border-l-2 border-teal pl-3 font-serif text-[13px] italic text-ink/80">“{e.quote}”</blockquote>}
            </div>
            <Cite s={e.source} {...src} />
          </li>
        ))}
        {rows.length === 0 && <li className="p-6 text-center text-sm text-muted">No entries match.</li>}
      </ol>
    </section>
  );
}

function Gaps({ a, gapDays, setGapDays }: { a: CaseAnalysis; gapDays: number; setGapDays: (n: number) => void }) {
  const dated = a.chronology;
  const first = dated[0]?.date, last = dated[dated.length - 1]?.date;
  const t0 = first ? Date.parse(first) : 0, t1 = last ? Date.parse(last) : 1;
  const span = Math.max(1, t1 - t0);
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Treatment timeline</h2>
        <label className="flex items-center gap-2 text-sm text-muted">
          Flag gaps longer than
          <select value={gapDays} onChange={(e) => setGapDays(Number(e.target.value))} className="rounded-md border border-line px-2 py-1 text-ink">
            {[14, 21, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
      </div>
      {dated.length > 1 && (
        <div className="relative mt-8 h-16">
          <div className="absolute left-0 right-0 top-6 h-1 rounded bg-paper" />
          {a.gaps.map((g, i) => {
            const l = ((Date.parse(g.from.date!) - t0) / span) * 100;
            const w = ((Date.parse(g.to.date!) - Date.parse(g.from.date!)) / span) * 100;
            return <div key={i} className="absolute top-5 h-3 rounded bg-danger/25" style={{ left: `${l}%`, width: `${w}%` }} title={`${g.days}-day gap`} />;
          })}
          {dated.map((e) => (
            <div key={e.id} className={`absolute top-4 h-5 w-1.5 -translate-x-1/2 rounded ${e.significance === "high" ? "bg-navy" : "bg-teal"}`} style={{ left: `${((Date.parse(e.date!) - t0) / span) * 100}%` }} title={`${e.date} — ${e.provider_name}`} />
          ))}
          <div className="absolute left-0 top-11 text-xs text-muted">{first}</div>
          <div className="absolute right-0 top-11 text-xs text-muted">{last}</div>
        </div>
      )}
      {a.gaps.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No gaps longer than {gapDays} days. Continuous care strengthens causation.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {a.gaps.map((g, i) => (
            <li key={i} className="rounded-xl border border-line p-4 text-sm">
              <div className="font-semibold text-danger">{g.days}-day gap</div>
              <div className="mt-1 grid gap-2 md:grid-cols-2">
                <div><span className="text-muted">Last visit:</span> {g.from.date} — {g.from.provider_name} ({g.from.specialty})</div>
                <div><span className="text-muted">Care resumed:</span> {g.to.date} — {g.to.provider_name} ({g.to.specialty})</div>
              </div>
              <div className="mt-2 text-muted">Tip: look for the reason (cost, childcare, transport, provider availability) in the notes around these dates and document it before the demand.</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Missing({ x, a, firm, ...src }: { x: CaseExtraction; a: CaseAnalysis; firm: FirmInfo } & SrcProps) {
  const [open, setOpen] = useState<number | null>(null);
  if (a.missing_records.length === 0) return <section className="rounded-2xl border border-line bg-white p-6 text-sm text-muted">Every record the file refers to appears to be present.</section>;
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted">These records are mentioned in the file but not present. Each one comes with a ready-to-send HIPAA records request.</p>
      {a.missing_records.map((m, i) => {
        const letter = recordsRequestLetter(x, m, firm);
        return (
          <div key={m.record.id} className="rounded-2xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{m.record.record_type}</div>
                <div className="text-sm">{m.record.provider_name}{m.record.date_text ? ` · ${m.record.date_text}` : ""}</div>
                <div className="mt-1 text-sm text-muted">{m.record.reason}</div>
              </div>
              <div className="flex items-center gap-2">
                <Cite s={m.record.source} {...src} />
                <button onClick={() => setOpen(open === i ? null : i)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-navy">
                  <Mail className="h-4 w-4" /> {open === i ? "Hide letter" : "Request letter"}
                </button>
                <button onClick={() => download(`Records_request_${safeName(m.record.provider_name)}.txt`, letter)} className="rounded-lg border border-line p-1.5 hover:border-navy" aria-label="Download letter">
                  <Download className="h-4 w-4" />
                </button>
              </div>
            </div>
            {open === i && <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-xl bg-paper p-4 font-serif text-[13px] leading-relaxed">{letter}</pre>}
          </div>
        );
      })}
    </section>
  );
}

function Billing({ a, onCsv, ...src }: { a: CaseAnalysis; onCsv: () => void } & SrcProps) {
  return (
    <div className="space-y-5">
      <section className="overflow-x-auto rounded-2xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line p-4">
          <h2 className="font-semibold">Medical specials by provider</h2>
          <button onClick={onCsv} className="inline-flex items-center gap-1.5 text-sm text-teal"><Download className="h-4 w-4" /> Billing CSV</button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-paper text-left text-xs uppercase text-muted">
            <tr><th className="px-4 py-2">Provider</th><th className="px-4 py-2">Specialty</th><th className="px-4 py-2">Visits</th><th className="px-4 py-2">Dates</th><th className="px-4 py-2 text-right">Billed</th><th className="px-4 py-2 text-right">Paid</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {a.providers.map((p) => (
              <tr key={p.key}>
                <td className="px-4 py-2 font-medium">{p.provider}<div className="text-xs font-normal text-muted">{p.clinicians.join(", ")}</div></td>
                <td className="px-4 py-2">{p.specialty}</td>
                <td className="px-4 py-2">{p.visits}</td>
                <td className="px-4 py-2 text-muted">{p.first_visit}{p.last_visit && p.last_visit !== p.first_visit ? ` → ${p.last_visit}` : ""}</td>
                <td className="px-4 py-2 text-right">{usd(p.billed)}</td>
                <td className="px-4 py-2 text-right">{usd(p.paid)}</td>
              </tr>
            ))}
            <tr className="bg-paper font-semibold"><td className="px-4 py-2" colSpan={4}>Total</td><td className="px-4 py-2 text-right">{usd(a.totals.billed)}</td><td className="px-4 py-2 text-right">{usd(a.totals.paid)}</td></tr>
          </tbody>
        </table>
      </section>
      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="font-semibold">Billing issues</h2>
        {a.billing_issues.length === 0 ? <p className="mt-2 text-sm text-muted">No issues found.</p> : (
          <ul className="mt-3 space-y-2">
            {a.billing_issues.map((i, k) => (
              <li key={k} className="flex flex-wrap items-start gap-3 text-sm sm:flex-nowrap">
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase ${sevStyle[i.severity]}`}>{i.kind.replace(/_/g, " ")}</span>
                <span className="min-w-0 flex-1 basis-48">{i.message}</span>
                {(i.bill ?? i.encounter) && <Cite s={(i.bill ?? i.encounter)!.source} {...src} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SettingsDialog({ firm, setFirm, gapDays, setGapDays, onClose }: { firm: FirmInfo; setFirm: (f: FirmInfo) => void; gapDays: number; setGapDays: (n: number) => void; onClose: () => void }) {
  const field = (k: keyof FirmInfo, label: string) => (
    <label className="block text-sm">
      <span className="text-muted">{label}</span>
      <input value={firm[k]} onChange={(e) => setFirm({ ...firm, [k]: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-navy" />
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <p className="mt-1 text-sm text-muted">Letterhead for records-request letters and reports. Saved in this browser only.</p>
        <div className="mt-4 space-y-3">
          {field("firm", "Firm name")}
          {field("attorney", "Attorney")}
          {field("address", "Address")}
          <div className="grid grid-cols-2 gap-3">{field("phone", "Phone")}{field("email", "Email")}</div>
          <label className="block text-sm">
            <span className="text-muted">Treatment-gap threshold (days)</span>
            <input type="number" min={7} max={365} value={gapDays} onChange={(e) => setGapDays(Math.max(7, Number(e.target.value) || 30))} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
          </label>
        </div>
        <button onClick={onClose} className="mt-5 w-full rounded-lg bg-navy py-2.5 font-medium text-white">Done</button>
      </div>
    </div>
  );
}
