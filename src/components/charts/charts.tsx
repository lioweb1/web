"use client";
import "./viz.css";
import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/ui/states";

type Row = { key: string; label: string; value: number };

const tooltipStyle = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)", boxShadow: "0 4px 12px rgb(0 0 0 / 0.12)" },
  labelStyle: { color: "var(--text-muted)", marginBottom: 2 },
  itemStyle: { color: "var(--text)", padding: 0 },
  cursor: { fill: "var(--surface-2)", opacity: 0.6 },
};

const axisTick = { fill: "var(--ink-muted)", fontSize: 11 };

/** Toggle between the chart and an accessible data table. */
function ChartFrame({ empty, emptyText, table, children, height }: { empty: boolean; emptyText: string; table: React.ReactNode; children: React.ReactNode; height: number }) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  if (empty) return <EmptyState className="py-8" title="No data yet" description={emptyText} />;
  return (
    <div className="viz">
      <div className="mb-1 flex justify-end">
        <button type="button" className="text-xs text-accent hover:underline" aria-controls={id} aria-expanded={showTable} onClick={() => setShowTable((s) => !s)}>
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>
      <div id={id}>{showTable ? table : <div style={{ height }}>{children}</div>}</div>
    </div>
  );
}

function SimpleTable({ rows, valueLabel = "Leads", format }: { rows: { label: string; values: (number | string)[] }[]; valueLabel?: string | string[]; format?: (n: number) => string }) {
  const heads = Array.isArray(valueLabel) ? valueLabel : [valueLabel];
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-1 pr-2 font-medium">Category</th>
            {heads.map((h) => (
              <th key={h} className="py-1 text-right font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border">
              <td className="py-1 pr-2">{r.label}</td>
              {r.values.map((v, i) => (
                <td key={i} className="tabular py-1 text-right">
                  {typeof v === "number" && format ? format(v) : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal bars for one categorical measure (single series → one hue, no legend). */
export function BarList({ data, emptyText = "Nothing recorded in this period.", ordinal = false, valueLabel = "Leads" }: { data: Row[]; emptyText?: string; ordinal?: boolean; valueLabel?: string }) {
  const height = Math.max(120, data.length * 30 + 30);
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ChartFrame empty={total === 0} emptyText={emptyText} height={height} table={<SimpleTable rows={data.map((d) => ({ label: d.label, values: [d.value] }))} valueLabel={valueLabel} />}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 0 }} barCategoryGap={4}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={{ stroke: "var(--axis)" }} tickLine={false} />
          <YAxis type="category" dataKey="label" width={150} tick={{ ...axisTick, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} interval={0} />
          <Tooltip {...tooltipStyle} formatter={(v) => [Number(v).toLocaleString(), valueLabel]} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: "right", fill: "var(--text-muted)", fontSize: 11 }} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={d.key} fill={ordinal ? `var(--ord-${Math.min(5, i + 1)})` : "var(--series-1)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Daily trend, single series. */
export function TrendLine({ data, valueLabel = "Leads discovered" }: { data: { date: string; value: number }[]; valueLabel?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ChartFrame empty={total === 0} emptyText="No leads were saved in this period." height={220} table={<SimpleTable rows={data.filter((d) => d.value).map((d) => ({ label: d.date, values: [d.value] }))} valueLabel={valueLabel} />}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--axis)" }} minTickGap={32} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
          <Tooltip {...tooltipStyle} cursor={{ stroke: "var(--axis)" }} formatter={(v) => [Number(v).toLocaleString(), valueLabel]} />
          <Line type="monotone" dataKey="value" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

type StackSeries = { key: string; label: string; color: string };

/** Stacked bars of status counts (status colors always paired with a text legend). */
export function StackedBars({ data, xKey, series, layout = "horizontal", emptyText }: { data: Record<string, string | number>[]; xKey: string; series: StackSeries[]; layout?: "horizontal" | "vertical"; emptyText: string }) {
  const total = data.reduce((s, d) => s + series.reduce((a, x) => a + Number(d[x.key] ?? 0), 0), 0);
  const vertical = layout === "vertical";
  const height = vertical ? Math.max(120, data.length * 32 + 40) : 220;
  return (
    <ChartFrame
      empty={total === 0}
      emptyText={emptyText}
      height={height}
      table={<SimpleTable rows={data.map((d) => ({ label: String(d[xKey]), values: series.map((s) => Number(d[s.key] ?? 0)) }))} valueLabel={series.map((s) => s.label)} />}
    >
      <div className="flex h-full flex-col">
        <ul className="mb-2 flex flex-wrap gap-3 text-xs text-muted" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color, height: 3 }} />
              {s.label}
            </li>
          ))}
        </ul>
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout={vertical ? "vertical" : "horizontal"} margin={{ top: 0, right: 12, bottom: 0, left: vertical ? 0 : -16 }}>
              <CartesianGrid vertical={vertical} horizontal={!vertical} stroke="var(--grid)" />
              {vertical ? (
                <>
                  <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={{ stroke: "var(--axis)" }} tickLine={false} />
                  <YAxis type="category" dataKey={xKey} width={170} tick={{ ...axisTick, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} interval={0} />
                </>
              ) : (
                <>
                  <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--axis)" }} minTickGap={24} tickFormatter={(d: string) => (/^\d{4}-/.test(d) ? d.slice(5) : d)} />
                  <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                </>
              )}
              <Tooltip {...tooltipStyle} />
              {series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} stroke="var(--surface)" strokeWidth={1} maxBarSize={vertical ? 18 : 28} radius={i === series.length - 1 ? (vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </ChartFrame>
  );
}
