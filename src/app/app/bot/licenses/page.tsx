import Link from "next/link";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { listLicenses } from "@/lib/queries/bot";
import { effectiveStatus } from "@/lib/services/bot";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/states";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { fmtDate, fmtRelative } from "@/components/ui/misc";
import { LicenseStatusBadge, PLAN_LABEL } from "../ui";
import { CopyKey } from "./copy-key";
import { LicenseForm } from "./license-form";
import { extendLicenseAction, reactivateLicenseAction, revokeLicenseAction } from "./actions";

export const metadata = { title: "Bot licenses" };

export default async function LicensesPage() {
  const ctx = await requireAuth();
  const rows = await listLicenses(ctx.workspace.id);
  const canEdit = hasRole(ctx, "admin");

  return (
    <>
      <PageHeader title="Bot licenses" description="Each key unlocks the trading bot for one customer. The bot validates its key on start-up and every few minutes; revoking a key stops it at the next check." />
      {!canEdit ? <Notice className="mb-6">Only workspace admins and owners can create or revoke licenses.</Notice> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Licenses" description={`${rows.length} key${rows.length === 1 ? "" : "s"}`} />
            {rows.length === 0 ? (
              <EmptyState title="No licenses yet" description="Create a key and paste it into the bot's config.yaml under license.key." />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Label</TH>
                    <TH>Key</TH>
                    <TH>Plan</TH>
                    <TH>Status</TH>
                    <TH>Expires</TH>
                    <TH className="text-right">Devices</TH>
                    <TH className="text-right">Trades</TH>
                    <TH>Last seen</TH>
                    {canEdit ? <TH className="text-right">Actions</TH> : null}
                  </tr>
                </THead>
                <tbody>
                  {rows.map((r) => {
                    const status = effectiveStatus(r);
                    return (
                      <TR key={r.id}>
                        <TD>
                          <Link href={`/app/bot/licenses/${r.id}`} className="font-medium text-accent hover:underline">{r.label}</Link>
                        </TD>
                        <TD>
                          <CopyKey value={r.key} />
                        </TD>
                        <TD className="text-xs">{PLAN_LABEL[r.plan] ?? r.plan}</TD>
                        <TD>
                          <LicenseStatusBadge status={status} />
                        </TD>
                        <TD className="text-xs text-muted">{r.expiresAt ? `${fmtDate(r.expiresAt)} (${fmtRelative(r.expiresAt)})` : "never"}</TD>
                        <TD className="tabular text-right">
                          {r.deviceCount}/{r.maxDevices}
                          {r.onlineCount ? <span className="ml-1 text-xs text-success">● {r.onlineCount}</span> : null}
                        </TD>
                        <TD className="tabular text-right">{r.tradeCount}</TD>
                        <TD className="text-xs text-muted">{r.lastSeenAt ? fmtRelative(r.lastSeenAt) : "never"}</TD>
                        {canEdit ? (
                          <TD>
                            <div className="flex justify-end gap-1">
                              <form action={extendLicenseAction}>
                                <input type="hidden" name="licenseId" value={r.id} />
                                <input type="hidden" name="days" value="30" />
                                <Button size="sm" variant="ghost" type="submit" title="Add 30 days to the expiry">+30d</Button>
                              </form>
                              {status === "revoked" || status === "expired" ? (
                                <form action={reactivateLicenseAction}>
                                  <input type="hidden" name="licenseId" value={r.id} />
                                  <Button size="sm" variant="ghost" type="submit">Reactivate</Button>
                                </form>
                              ) : (
                                <ConfirmDialog
                                  trigger={
                                    <Button size="sm" variant="ghost" className="text-danger">Revoke</Button>
                                  }
                                  title="Revoke this license?"
                                  description="The bot stops at its next license check. Trade history is kept and you can reactivate later."
                                  confirmLabel="Revoke"
                                  action={revokeLicenseAction}
                                  hidden={{ licenseId: r.id }}
                                />
                              )}
                            </div>
                          </TD>
                        ) : null}
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        {canEdit ? (
          <Card>
            <CardHeader title="New license" />
            <CardBody>
              <LicenseForm />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
