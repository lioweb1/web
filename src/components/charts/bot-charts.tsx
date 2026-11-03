"use client";
import "./viz.css";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, SimpleTable, axisTick, tooltipStyle } from "./charts";

const money = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

/** Cumulative profit over time, in account currency. */
export function EquityCurve({ data }: { data: { t: string; value: number }[] }) {
  const fmtT = (t: string) => t.slice(5, 16).replace("T", " ");
  return (
    <ChartFrame empty={data.length === 0} emptyText="No trades in this period." height={240} table={<SimpleTable rows={data.map((d) => ({ label: fmtT(d.t), values: [d.value] }))} valueLabel="Cumulative P&L" format={money} />}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="t" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--axis)" }} minTickGap={48} tickFormatter={fmtT} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => v.toFixed(0)} />
          <ReferenceLine y={0} stroke="var(--axis)" strokeDasharray="3 3" />
          <Tooltip {...tooltipStyle} cursor={{ stroke: "var(--axis)" }} labelFormatter={(l) => fmtT(String(l))} formatter={(v) => [money(Number(v)), "Cumulative P&L"]} />
          <Line type="monotone" dataKey="value" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Win rate per UTC hour; bars below the breakeven line are the hours to switch off. */
export function HourlyWinRate({ data, breakeven = 54.1 }: { data: { hour: string; trades: number; winRate: number | null }[]; breakeven?: number }) {
  const rows = data.map((d) => ({ ...d, value: d.winRate ?? 0 }));
  const total = data.reduce((s, d) => s + d.trades, 0);
  return (
    <ChartFrame empty={total === 0} emptyText="No trades in this period." height={220} table={<SimpleTable rows={data.filter((d) => d.trades).map((d) => ({ label: d.hour, values: [d.trades, d.winRate === null ? "—" : `${d.winRate}%`] }))} valueLabel={["Trades", "Win rate"]} />}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="hour" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--axis)" }} interval={1} />
          <YAxis domain={[0, 100]} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
          <ReferenceLine y={breakeven} stroke="var(--status-critical)" strokeDasharray="4 3" label={{ value: "breakeven", position: "insideTopRight", fill: "var(--text-muted)", fontSize: 10 }} />
          <Tooltip {...tooltipStyle} formatter={(v, _n, item) => [`${Number(v).toFixed(1)}% (${(item.payload as { trades: number }).trades} trades)`, "Win rate"]} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={20} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.hour} fill={r.trades === 0 ? "var(--neutral-mark)" : r.value >= breakeven ? "var(--status-good)" : "var(--status-critical)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
