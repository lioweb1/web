"use client";

import { useState } from "react";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

type SliderProps = { label: string; value: number; set: (n: number) => void; min: number; max: number; step: number; fmt: (n: number) => string };

function Slider({ label, value, set, min, max, step, fmt }: SliderProps) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-semibold">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="w-full accent-teal" />
    </label>
  );
}

export function RoiCalculator() {
  const [cases, setCases] = useState(20);
  const [pages, setPages] = useState(1200);
  const [rate, setRate] = useState(65);

  // Manual review: ~50 pages/hour incl. writing. MedChrono: ~1 hour of attorney/paralegal verification per case.
  const manualHours = (cases * pages) / 50;
  const toolHours = cases * 1;
  const saved = (manualHours - toolHours) * rate * 12;
  const daysPerCase = pages / 50 / 8;

  return (
    <div className="grid gap-8 rounded-2xl border border-line bg-white p-6 shadow-sm md:grid-cols-2 md:p-8">
      <div className="space-y-6">
        <Slider label="Cases reviewed per month" value={cases} set={setCases} min={1} max={200} step={1} fmt={String} />
        <Slider label="Average pages of records per case" value={pages} set={setPages} min={100} max={8000} step={100} fmt={(n) => n.toLocaleString()} />
        <Slider label="Reviewer cost per hour (nurse / paralegal)" value={rate} set={setRate} min={25} max={150} step={5} fmt={(n) => `$${n}`} />
      </div>
      <div className="flex flex-col justify-center rounded-xl bg-navy p-6 text-white">
        <div className="text-sm text-white/70">Manual review today</div>
        <div className="text-2xl font-semibold">{daysPerCase.toFixed(1)} working days per case</div>
        <div className="mt-4 text-sm text-white/70">With MedChrono AI</div>
        <div className="text-2xl font-semibold">≈ 1 hour of verification</div>
        <div className="mt-6 text-sm text-white/70">Reviewer cost saved per year</div>
        <div className="font-serif text-4xl font-bold text-[#7fe0d6]">{usd(Math.max(0, saved))}</div>
        <div className="mt-2 text-xs text-white/60">Assumes ~50 pages/hour for manual review and summary writing.</div>
      </div>
    </div>
  );
}
