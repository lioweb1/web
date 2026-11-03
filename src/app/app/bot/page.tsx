import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";
import { getBotOverview, parseBotFilter, botFilterQuery } from "@/lib/queries/bot";
import { PageHeader, Card, CardHeader, CardBody, KpiCard } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { fmtDate } from "@/components/ui/misc";
import { EquityCurve, HourlyWinRate } from "@/components/charts/bot-charts";
import { OutcomeBadge, pnlClass } from "./ui";

export const metadata = { title: "Bot dashboard" };

export default async function BotPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireAuth();
  const f = parseBotFilter(await searchParams);
  const o = await getBotOverview(ctx.workspace.id, f);
  const q = (over: Parameters<typeof botFilterQuery>[1]) => `/app/bot${botFilterQuery(f, over)}`;

  return (
    <>
      <PageHeader
        title="Bot dashboard"
        description={`Trades reported by licensed bots, ${fmtDate(f.from)} – ${fmtDate(f.to)}. Results are what the bots sent; nothing here is a forecast.`}
        actions={
          <Button asChild variant="primary">
            <Link href="/app/bot/licenses">Manage licenses</Link>
          </Button>
        }
      />

      <div className="mb-6 rounded-lg border border-border bg-surface p-3 shadow-card">
        <form action="/app/bot" method="get" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="range" className="block text-xs font-medium text-muted">Date range</label>
            <Select id="range" name="range" defaultValue={f.preset} className="w-36">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="custom">Custom range</option>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="from" className="block text-xs font-medium text-muted">From (custom)</label>
            <Input id="from" name="from" type="date" defaultValue={f.from.toISOString().slice(0, 10)} className="w-40" />
          </div>
          <div className="space-y-1">
            <label htmlFor="to" className="block text-xs font-medium text-muted">To (custom)</label>
            <Input id="to" name="to" type="date" defaultValue={f.to.toISOString().slice(0, 10)} className="w-40" />
          </div>
          <div className="space-y-1">
            <label htmlFor="license" className="block text-xs font-medium text-muted">License</label>
            <Select id="license" name="license" defaultValue={f.license ?? ""} className="w-44">
              <option value="">All licenses</option>
              {o.licenses.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="symbol" className="block text-xs font-medium text-muted">Symbol</label>
            <Select id="symbol" name="symbol" defaultValue={f.symbol ?? ""} className="w-36">
              <option value="">All symbols</option>
              {o.symbols.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="outcome" className="block text-xs font-medium text-muted">Outcome</label>
            <Select id="outcome" name="outcome" defaultValue={f.outcome ?? ""} className="w-28">
              <option value="">All</option>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="tie">Tie</option>
            </Select>
          </div>
          <Button type="submit" variant="primary">Apply</Button>
          {f.license || f.symbol || f.outcome ? (
            <Button asChild variant="ghost">
              <Link href={q({ license: null, symbol: null, outcome: null })}>Clear</Link>
            </Button>
          ) : null}
        </form>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Active licenses" value={o.activeLicenses.toLocaleString()} hint={`${o.totalLicenses} total`} href="/app/bot/licenses" />
        <KpiCard label="Devices online" value={o.devicesOnline.toLocaleString()} hint={`of ${o.devicesTotal} · seen in last 5 min`} />
        <KpiCard label="Trades today" value={o.tradesToday.toLocaleString()} hint="UTC day" />
        <KpiCard label="Trades in period" value={o.trades.toLocaleString()} hint={`${o.wins} won · ${o.losses} lost`} />
        <KpiCard label="Win rate" value={o.winRate === null ? "—" : `${o.winRate.toFixed(1)}%`} hint="wins / (wins + losses)" />
        <KpiCard label="Net P&L" value={<span className={pnlClass(o.pnl)}>{o.pnl >= 0 ? "+" : ""}{o.pnl.toFixed(2)}</span>} hint="account currency, as reported" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="Equity curve" description="Cumulative P&L of the filtered trades, in trade order" />
          <CardBody>
            <EquityCurve data={o.equity} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Win rate by hour (UTC)" description="Red bars are below the 85%-payout breakeven of 54.1%. Use them to set the bot's trade hours." />
          <CardBody>
            <HourlyWinRate data={o.byHour} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="By symbol" description="Top 30 symbols by trade count in the period" />
          {o.bySymbol.length === 0 ? (
            <EmptyState className="py-8" title="No trades yet" description="Once a bot sends trades they are grouped here." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Symbol</TH>
                  <TH className="text-right">Trades</TH>
                  <TH className="text-right">Win rate</TH>
                  <TH className="text-right">P&L</TH>
                </tr>
              </THead>
              <tbody>
                {o.bySymbol.map((s) => (
                  <TR key={s.symbol}>
                    <TD>
                      <Link href={q({ symbol: s.symbol })} className="text-accent hover:underline">{s.symbol}</Link>
                    </TD>
                    <TD className="tabular text-right">{s.trades}</TD>
                    <TD className="tabular text-right">{s.winRate === null ? "—" : `${s.winRate.toFixed(1)}%`}</TD>
                    <TD className={`tabular text-right ${pnlClass(s.pnl)}`}>{s.pnl >= 0 ? "+" : ""}{s.pnl.toFixed(2)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Recent trades" description="Latest 50 trades matching the filter" />
          {o.recent.length === 0 ? (
            <EmptyState className="py-8" title="No trades in this period" description="Point a bot at this workspace with a license key and its trades appear here." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>License</TH>
                  <TH>Device</TH>
                  <TH>Symbol</TH>
                  <TH>Dir</TH>
                  <TH className="text-right">Stake</TH>
                  <TH className="text-right">Conf.</TH>
                  <TH>Outcome</TH>
                  <TH className="text-right">P&L</TH>
                  <TH>Strategy</TH>
                </tr>
              </THead>
              <tbody>
                {o.recent.map((t) => (
                  <TR key={t.id}>
                    <TD className="whitespace-nowrap text-xs text-muted">{fmtDate(t.tradedAt, true)}</TD>
                    <TD>
                      <Link href={`/app/bot/licenses/${t.licenseId}`} className="text-accent hover:underline">{t.licenseLabel}</Link>
                    </TD>
                    <TD className="text-xs text-muted">{t.hostname ?? "—"}</TD>
                    <TD>{t.symbol}</TD>
                    <TD>
                      <Badge tone={t.direction === "CALL" ? "success" : "danger"}>{t.direction}</Badge>
                    </TD>
                    <TD className="tabular text-right">{t.stake.toFixed(2)}</TD>
                    <TD className="tabular text-right">{t.confidence === null ? "—" : `${Math.round(t.confidence * 100)}%`}</TD>
                    <TD>
                      <OutcomeBadge outcome={t.outcome} />
                    </TD>
                    <TD className={`tabular text-right ${pnlClass(t.pnl)}`}>{t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}</TD>
                    <TD className="text-xs text-muted">{[t.strategy, t.broker].filter(Boolean).join(" · ") || "—"}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
