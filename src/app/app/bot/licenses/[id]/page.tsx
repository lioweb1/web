import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { getLicenseDetail } from "@/lib/queries/bot";
import { effectiveStatus } from "@/lib/services/bot";
import { PageHeader, Card, CardHeader, CardBody, KpiCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/states";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Textarea } from "@/components/ui/input";
import { fmtDate, fmtRelative } from "@/components/ui/misc";
import { LicenseStatusBadge, OutcomeBadge, PLAN_LABEL, pnlClass } from "../../ui";
import { CopyKey } from "../copy-key";
import { deleteDeviceAction, deleteLicenseAction, extendLicenseAction, reactivateLicenseAction, revokeLicenseAction, updateNotesAction } from "../actions";

export const metadata = { title: "Bot license" };

export default async function LicenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await getLicenseDetail(ctx.workspace.id, id);
  if (!d) notFound();
  const { license: L, devices, trades, stats } = d;
  const status = effectiveStatus(L);
  const canEdit = hasRole(ctx, "admin");
  const online = (t: Date) => Date.now() - t.getTime() < 5 * 60_000;
  const f = L.features;

  return (
    <>
      <PageHeader
        title={L.label}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <LicenseStatusBadge status={status} />
            <span>{PLAN_LABEL[L.plan] ?? L.plan}</span>
            <span>· expires {L.expiresAt ? `${fmtDate(L.expiresAt)} (${fmtRelative(L.expiresAt)})` : "never"}</span>
            <span>· created {fmtDate(L.createdAt)}</span>
          </span>
        }
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/app/bot/licenses">All licenses</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href={`/app/bot?license=${L.id}`}>Dashboard for this license</Link>
            </Button>
            {canEdit ? (
              <>
                <form action={extendLicenseAction}>
                  <input type="hidden" name="licenseId" value={L.id} />
                  <input type="hidden" name="days" value="30" />
                  <Button type="submit">Extend 30 days</Button>
                </form>
                {status === "active" ? (
                  <ConfirmDialog trigger={<Button variant="danger">Revoke</Button>} title="Revoke this license?" description="The bot stops at its next license check. Trade history is kept." confirmLabel="Revoke" action={revokeLicenseAction} hidden={{ licenseId: L.id }} />
                ) : (
                  <form action={reactivateLicenseAction}>
                    <input type="hidden" name="licenseId" value={L.id} />
                    <Button type="submit" variant="primary">Reactivate</Button>
                  </form>
                )}
                {hasRole(ctx, "owner") ? (
                  <ConfirmDialog trigger={<Button variant="ghost" className="text-danger">Delete</Button>} title="Delete this license permanently?" description="Its devices, status and every trade it reported are deleted too. Revoke instead if you may need the history." confirmLabel="Delete license" action={deleteLicenseAction} hidden={{ licenseId: L.id }} />
                ) : null}
              </>
            ) : null}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Trades" value={stats.trades.toLocaleString()} hint={`${stats.wins} won · ${stats.losses} lost`} />
        <KpiCard label="Win rate" value={stats.winRate === null ? "—" : `${stats.winRate.toFixed(1)}%`} />
        <KpiCard label="Net P&L" value={<span className={pnlClass(stats.pnl)}>{stats.pnl >= 0 ? "+" : ""}{stats.pnl.toFixed(2)}</span>} />
        <KpiCard label="Devices" value={`${devices.length}/${L.maxDevices}`} hint={`${devices.filter((x) => online(x.device.lastSeenAt)).length} online`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Key & features" />
          <CardBody className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-medium text-muted">License key</p>
              <CopyKey value={L.key} full />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={f.auto_trade ? "success" : "neutral"}>{f.auto_trade ? "auto trade" : "signals only"}</Badge>
              {f.copier ? <Badge tone="accent">copier</Badge> : null}
              {f.extension ? <Badge tone="accent">extension</Badge> : null}
              <Badge tone="outline">max {f.max_symbols ?? 1} symbols</Badge>
              {(f.brokers ?? []).map((b) => (
                <Badge key={b} tone="outline">{b}</Badge>
              ))}
            </div>
            {canEdit ? (
              <ActionForm action={updateNotesAction} submitLabel="Save notes">
                <input type="hidden" name="licenseId" value={L.id} />
                <Field label="Notes" htmlFor="notes" hint="Internal only.">
                  <Textarea id="notes" name="notes" defaultValue={L.notes ?? ""} maxLength={2000} />
                </Field>
              </ActionForm>
            ) : L.notes ? (
              <p className="whitespace-pre-wrap text-xs text-muted">{L.notes}</p>
            ) : null}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Devices" description="Machines that validated this key. Delete one to free a slot." />
          {devices.length === 0 ? (
            <EmptyState className="py-8" title="No device yet" description="The first machine to validate the key is registered here." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Host</TH>
                  <TH>Broker</TH>
                  <TH>Version</TH>
                  <TH>Last seen</TH>
                  <TH className="text-right">Balance</TH>
                  <TH>Today</TH>
                  <TH>Config</TH>
                  {canEdit ? <TH /> : null}
                </tr>
              </THead>
              <tbody>
                {devices.map(({ device, status: s }) => {
                  const sum = s?.summary ?? {};
                  const cfg = s?.config ?? {};
                  return (
                    <TR key={device.id}>
                      <TD>
                        <span className="flex items-center gap-1.5">
                          <span className={online(device.lastSeenAt) ? "text-success" : "text-subtle"}>●</span>
                          {device.hostname ?? device.machineId.slice(0, 12)}
                        </span>
                      </TD>
                      <TD className="text-xs">{device.broker ?? "—"}</TD>
                      <TD className="text-xs text-muted">{device.version ?? "—"}</TD>
                      <TD className="text-xs text-muted">{fmtRelative(device.lastSeenAt)}</TD>
                      <TD className="tabular text-right">{s?.balance != null ? s.balance.toFixed(2) : "—"}</TD>
                      <TD className="text-xs">
                        {s ? (
                          <>
                            {sum.wins ?? 0}W/{sum.losses ?? 0}L · <span className={pnlClass(sum.pnl ?? 0)}>{(sum.pnl ?? 0) >= 0 ? "+" : ""}{(sum.pnl ?? 0).toFixed(2)}</span>
                            {sum.halted ? <Badge tone="warning" className="ml-1">halted: {sum.halted}</Badge> : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TD className="text-xs text-muted">{[Array.isArray(cfg.symbols) ? (cfg.symbols as string[]).join(", ") : null, cfg.expiry_sec ? `${cfg.expiry_sec}s` : null, Array.isArray(cfg.strategies) ? (cfg.strategies as string[]).join("+") : null].filter(Boolean).join(" · ") || "—"}</TD>
                      {canEdit ? (
                        <TD className="text-right">
                          <ConfirmDialog trigger={<Button size="sm" variant="ghost" className="text-danger">Remove</Button>} title="Remove this device?" description="The machine can register again if a slot is free. Its status row is removed; trades are kept." confirmLabel="Remove device" action={deleteDeviceAction} hidden={{ licenseId: L.id, deviceId: device.id }} />
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Trades" description="Latest 100 trades reported for this license" />
          {trades.length === 0 ? (
            <EmptyState className="py-8" title="No trades yet" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>Symbol</TH>
                  <TH>Dir</TH>
                  <TH className="text-right">Stake</TH>
                  <TH className="text-right">Conf.</TH>
                  <TH>Outcome</TH>
                  <TH className="text-right">P&L</TH>
                  <TH>Strategy</TH>
                  <TH>Reasons</TH>
                </tr>
              </THead>
              <tbody>
                {trades.map((t) => (
                  <TR key={t.id}>
                    <TD className="whitespace-nowrap text-xs text-muted">{fmtDate(t.tradedAt, true)}</TD>
                    <TD>{t.symbol}</TD>
                    <TD>
                      <Badge tone={t.direction === "CALL" ? "success" : "danger"}>{t.direction}</Badge>
                    </TD>
                    <TD className="tabular text-right">{t.stake.toFixed(2)}</TD>
                    <TD className="tabular text-right">{t.confidence == null ? "—" : `${Math.round(t.confidence * 100)}%`}</TD>
                    <TD>
                      <OutcomeBadge outcome={t.outcome} />
                    </TD>
                    <TD className={`tabular text-right ${pnlClass(t.pnl)}`}>{t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}</TD>
                    <TD className="text-xs text-muted">{[t.strategy, t.broker].filter(Boolean).join(" · ") || "—"}</TD>
                    <TD className="max-w-xs truncate text-xs text-muted" title={t.reasons.join("; ")}>{t.reasons.join("; ") || "—"}</TD>
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
