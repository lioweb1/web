import { and, desc, eq } from "drizzle-orm";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { schema, systemDb, withTenant } from "@/lib/db";
import { PageHeader, Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input, Select, Field, Checkbox } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/states";
import { Tabs, fmtDate, fmtRelative } from "@/components/ui/misc";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { CountrySelector } from "@/components/ui/country-selector";
import { REGIONS, countryName, flag } from "@/lib/countries";
import {
  updateProfileAction, changePasswordAction, updateWorkspaceAction, createWorkspaceAction, addMemberAction, setRoleAction, removeMemberAction,
  saveMarketAction, deleteMarketAction, setDefaultMarketAction, restorePremiumAction, createWebhookAction, toggleWebhookAction, deleteWebhookAction,
  deleteWorkspaceAction, deleteAccountAction,
} from "./actions";

export const metadata = { title: "Settings" };

const TABS = [
  ["profile", "Profile"],
  ["workspace", "Workspace"],
  ["members", "Members"],
  ["markets", "Target markets"],
  ["webhooks", "Webhooks"],
  ["privacy", "Privacy & data"],
  ["audit", "Audit log"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAuth();
  const { tab: raw } = await searchParams;
  const tab: Tab = (TABS.find(([k]) => k === raw)?.[0] ?? "profile") as Tab;
  return (
    <>
      <PageHeader title="Settings" description={`${ctx.workspace.name} · your role: ${ctx.role}`} />
      <Tabs active={tab} tabs={TABS.filter(([k]) => k !== "audit" || hasRole(ctx, "admin")).map(([id, label]) => ({ id, label, href: `/app/settings?tab=${id}` }))} />
      {tab === "profile" ? <ProfileTab /> : null}
      {tab === "workspace" ? <WorkspaceTab /> : null}
      {tab === "members" ? <MembersTab /> : null}
      {tab === "markets" ? <MarketsTab /> : null}
      {tab === "webhooks" ? <WebhooksTab /> : null}
      {tab === "privacy" ? <PrivacyTab /> : null}
      {tab === "audit" ? <AuditTab /> : null}
    </>
  );
}

async function ProfileTab() {
  const ctx = await requireAuth();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Profile" />
        <CardBody>
          <ActionForm action={updateProfileAction}>
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" defaultValue={ctx.user.name} required maxLength={100} />
            </Field>
            <Field label="Email" htmlFor="email" hint="Email changes are not supported yet.">
              <Input id="email" value={ctx.user.email} disabled readOnly />
            </Field>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Change password" description="Changing your password signs you out on all other devices." />
        <CardBody>
          <ActionForm action={changePasswordAction} submitLabel="Change password">
            <Field label="Current password" htmlFor="current">
              <Input id="current" name="current" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="New password" htmlFor="next" hint="At least 10 characters.">
              <Input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm">
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
            </Field>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

async function WorkspaceTab() {
  const ctx = await requireAuth();
  const [ws] = await systemDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspace.id));
  const canEdit = hasRole(ctx, "admin");
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Workspace" description="Technologies and industries feed the explainable lead score (technology compatibility and industry relevance factors)." />
        <CardBody>
          <ActionForm action={updateWorkspaceAction}>
            <fieldset disabled={!canEdit} className="space-y-4">
              <Field label="Workspace name" htmlFor="ws-name">
                <Input id="ws-name" name="name" defaultValue={ws.name} required maxLength={100} />
              </Field>
              <Field label="Technologies you build with" htmlFor="tech" hint="Comma-separated, e.g. WordPress, Webflow, Shopify">
                <Input id="tech" name="preferredTechnologies" defaultValue={(ws.settings.preferredTechnologies ?? []).join(", ")} />
              </Field>
              <Field label="Target industries" htmlFor="ind" hint="Comma-separated, e.g. Healthcare, Construction, Hospitality. Leave empty to score industry neutrally.">
                <Input id="ind" name="targetIndustries" defaultValue={(ws.settings.targetIndustries ?? []).join(", ")} />
              </Field>
              <Field label="Services you offer" htmlFor="svc" hint="Comma-separated, shown alongside recommendations.">
                <Input id="svc" name="services" defaultValue={(ws.settings.services ?? []).join(", ")} />
              </Field>
            </fieldset>
            {!canEdit ? <p className="text-xs text-muted">Only admins can change workspace settings.</p> : null}
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="New workspace" description="Separate workspaces keep leads, notes and rules fully isolated (e.g. per client)." />
        <CardBody>
          <ActionForm action={createWorkspaceAction} submitLabel="Create workspace" pendingText="Creating…">
            <Field label="Name" htmlFor="new-ws">
              <Input id="new-ws" name="name" required maxLength={100} placeholder="e.g. Client: Acme" />
            </Field>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

async function MembersTab() {
  const ctx = await requireAuth();
  const members = await systemDb()
    .select({ userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role, since: schema.memberships.createdAt })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.workspaceId, ctx.workspace.id));
  const canManage = hasRole(ctx, "admin");
  return (
    <div className="space-y-6">
      {canManage ? (
        <Card>
          <CardHeader title="Add member" description="The person needs a LeadOrbit account first. Viewers can read; members can edit leads; admins manage settings and data sources." />
          <CardBody>
            <ActionForm action={addMemberAction} inline submitLabel="Add member">
              <Field label="Email" htmlFor="m-email" className="min-w-64 flex-1">
                <Input id="m-email" name="email" type="email" required />
              </Field>
              <Field label="Role" htmlFor="m-role">
                <Select id="m-role" name="role" defaultValue="member" className="w-36">
                  <option value="viewer">Viewer</option>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={`Members (${members.length})`} />
        <Table>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH>Member since</TH>
              {canManage ? <TH className="text-right">Actions</TH> : null}
            </tr>
          </THead>
          <tbody>
            {members.map((m) => (
              <TR key={m.userId}>
                <TD>
                  <p className="font-medium">
                    {m.name} {m.userId === ctx.user.id ? <span className="text-xs text-muted">(you)</span> : null}
                  </p>
                  <p className="text-xs text-muted">{m.email}</p>
                </TD>
                <TD>
                  <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{m.role}</Badge>
                </TD>
                <TD className="text-muted">{fmtDate(m.since)}</TD>
                {canManage ? (
                  <TD>
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      <ActionForm action={setRoleAction} inline submitLabel="Update" submitVariant="secondary">
                        <input type="hidden" name="userId" value={m.userId} />
                        <label className="sr-only" htmlFor={`role-${m.userId}`}>
                          Role for {m.name}
                        </label>
                        <Select id={`role-${m.userId}`} name="role" defaultValue={m.role} className="h-8 w-28 text-xs">
                          {hasRole(ctx, "owner") ? <option value="owner">Owner</option> : null}
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </Select>
                      </ActionForm>
                      <ConfirmAction action={removeMemberAction} hidden={{ userId: m.userId }} label="Remove" title={`Remove ${m.name}?`} description="They lose access to this workspace immediately. Their notes and activity remain." confirmLabel="Remove member" />
                    </div>
                  </TD>
                ) : null}
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function MarketFields({ m }: { m?: { id: string; name: string; mode: string; countries: string[]; regions: string[]; cities: string[] } }) {
  const p = m?.id ?? "new";
  return (
    <>
      {m ? <input type="hidden" name="id" value={m.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`mk-name-${p}`}>
          <Input id={`mk-name-${p}`} name="name" defaultValue={m?.name ?? ""} required maxLength={80} />
        </Field>
        <Field label="Mode" htmlFor={`mk-mode-${p}`} hint="“All countries” ignores the country list.">
          <Select id={`mk-mode-${p}`} name="mode" defaultValue={m?.mode ?? "custom"}>
            <option value="premium">Premium Markets preset</option>
            <option value="all">All countries</option>
            <option value="custom">Custom selection</option>
          </Select>
        </Field>
      </div>
      <Field label="Countries" htmlFor={`mk-c-${p}`}>
        <CountrySelector id={`mk-c-${p}`} name="countries" defaultValue={m?.countries ?? []} allowAll={false} />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Regions (optional)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {REGIONS.map((r) => (
            <Checkbox key={r} name="regions" value={r} defaultChecked={m?.regions.includes(r)} label={r} />
          ))}
        </div>
      </fieldset>
      <Field label="Cities (optional)" htmlFor={`mk-city-${p}`} hint="Comma-separated. Used as defaults for location-based sources such as OpenStreetMap.">
        <Input id={`mk-city-${p}`} name="cities" defaultValue={m?.cities.join(", ") ?? ""} />
      </Field>
      <Checkbox name="makeDefault" label="Use as the default target market" />
    </>
  );
}

async function MarketsTab() {
  const ctx = await requireAuth();
  const [markets, [ws]] = await Promise.all([
    withTenant(ctx.workspace.id, (tx) => tx.select().from(schema.targetMarkets).where(eq(schema.targetMarkets.workspaceId, ctx.workspace.id)).orderBy(schema.targetMarkets.createdAt)),
    systemDb().select({ def: schema.workspaces.defaultTargetMarketId }).from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspace.id)),
  ]);
  return (
    <div className="space-y-6">
      <Notice>
        Target markets set which countries count as a match in lead scoring and filters. Being in a market adds the “target country match” points only — it never implies purchasing intent. Change them any time; no code changes needed.
      </Notice>
      <div className="flex justify-end">
        <ActionForm action={restorePremiumAction} submitLabel="Restore Premium Markets preset" submitVariant="secondary" inline>
          <span />
        </ActionForm>
      </div>
      {markets.length === 0 ? <EmptyState title="No target markets" description="Create one below or restore the Premium Markets preset." /> : null}
      {markets.map((m) => (
        <Card key={m.id}>
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {m.name} {ws.def === m.id ? <Badge tone="accent">Default</Badge> : null}
                <Badge tone="outline">{m.mode === "all" ? "All countries" : `${m.countries.length} countries`}</Badge>
              </span>
            }
            description={m.mode === "all" ? "Every country" : m.countries.slice(0, 18).map((c) => `${flag(c)} ${countryName(c)}`).join(", ") + (m.countries.length > 18 ? "…" : "")}
            action={
              <div className="flex gap-1">
                {ws.def !== m.id ? (
                  <ActionForm action={setDefaultMarketAction} inline submitLabel="Make default" submitVariant="ghost">
                    <input type="hidden" name="id" value={m.id} />
                  </ActionForm>
                ) : null}
                <ConfirmAction action={deleteMarketAction} hidden={{ id: m.id }} label="Delete" title={`Delete “${m.name}”?`} description="Monitoring rules keep their own country lists and are not affected." confirmLabel="Delete market" />
              </div>
            }
          />
          <CardBody>
            <details>
              <summary className="cursor-pointer text-sm text-accent">Edit</summary>
              <div className="mt-4">
                <ActionForm action={saveMarketAction}>
                  <MarketFields m={m} />
                </ActionForm>
              </div>
            </details>
          </CardBody>
        </Card>
      ))}
      <Card>
        <CardHeader title="New target market" />
        <CardBody>
          <ActionForm action={saveMarketAction} submitLabel="Create market">
            <MarketFields />
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

async function WebhooksTab() {
  const ctx = await requireAuth();
  const hooks = await withTenant(ctx.workspace.id, (tx) => tx.select().from(schema.webhooks).where(eq(schema.webhooks.workspaceId, ctx.workspace.id)).orderBy(desc(schema.webhooks.createdAt)));
  const canEdit = hasRole(ctx, "admin");
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Webhooks" description="Send lead events to Zapier, Make, n8n, your own CRM or any HTTPS endpoint. Deliveries retry with exponential backoff." />
        <CardBody className="space-y-4 text-sm">
          <p>
            Each request is a JSON <code className="font-mono text-xs">POST</code> with headers <code className="font-mono text-xs">X-LeadOrbit-Timestamp</code> and{" "}
            <code className="font-mono text-xs">X-LeadOrbit-Signature: sha256=&lt;hex&gt;</code>, where the signature is the HMAC-SHA256 of <code className="font-mono text-xs">{"`${timestamp}.${body}`"}</code> using your signing secret. Reject requests whose signature doesn’t match or whose timestamp is older than 5 minutes.
          </p>
          {canEdit ? (
            <ActionForm action={createWebhookAction} submitLabel="Create webhook">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Endpoint URL (https)" htmlFor="wh-url" className="sm:col-span-2">
                  <Input id="wh-url" name="url" type="url" placeholder="https://hooks.example.com/leadorbit" required />
                </Field>
                <Field label="Minimum score" htmlFor="wh-min">
                  <Input id="wh-min" name="minScore" type="number" min={0} max={100} defaultValue={0} />
                </Field>
              </div>
              <fieldset className="flex flex-wrap gap-4">
                <legend className="mb-1.5 text-sm font-medium">Events</legend>
                <Checkbox name="events" value="lead.created" defaultChecked label="lead.created" />
                <Checkbox name="events" value="lead.qualified" label="lead.qualified" />
                <Checkbox name="events" value="lead.status_changed" label="lead.status_changed" />
              </fieldset>
            </ActionForm>
          ) : (
            <p className="text-xs text-muted">Only admins can manage webhooks.</p>
          )}
        </CardBody>
      </Card>
      <Card>
        {hooks.length === 0 ? (
          <EmptyState title="No webhooks" description="Create one above to push qualified leads to other tools." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Endpoint</TH>
                <TH>Events</TH>
                <TH>Min score</TH>
                <TH>Last delivery</TH>
                <TH>Status</TH>
                {canEdit ? <TH className="text-right">Actions</TH> : null}
              </tr>
            </THead>
            <tbody>
              {hooks.map((h) => (
                <TR key={h.id}>
                  <TD className="max-w-xs break-all font-mono text-xs">{h.url}</TD>
                  <TD className="text-xs">{h.events.join(", ")}</TD>
                  <TD className="tabular">{h.minScore}</TD>
                  <TD className="text-xs text-muted">
                    {h.lastDeliveryAt ? (
                      <>
                        {fmtRelative(h.lastDeliveryAt)} · <span className={h.lastStatus && h.lastStatus < 300 ? "text-success" : "text-danger"}>HTTP {h.lastStatus}</span>
                      </>
                    ) : (
                      "Never"
                    )}
                  </TD>
                  <TD>{h.active ? <Badge tone="success">Active</Badge> : <Badge>Paused</Badge>}</TD>
                  {canEdit ? (
                    <TD>
                      <div className="flex justify-end gap-1">
                        <ActionForm action={toggleWebhookAction} inline submitLabel={h.active ? "Pause" : "Enable"} submitVariant="ghost">
                          <input type="hidden" name="id" value={h.id} />
                          <input type="hidden" name="active" value={h.active ? "0" : "1"} />
                        </ActionForm>
                        <ConfirmAction action={deleteWebhookAction} hidden={{ id: h.id }} label="Delete" title="Delete webhook?" description="Pending deliveries to this endpoint will be skipped." confirmLabel="Delete webhook" />
                      </div>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

async function PrivacyTab() {
  const ctx = await requireAuth();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Export workspace data" description="Download everything this workspace stores — leads, business records, contacts, notes, activity, rules — as JSON. API keys and secrets are never included." />
        <CardBody>
          {hasRole(ctx, "admin") ? (
            <Button asChild variant="secondary">
              <a href="/api/workspace/export" download>
                Download JSON export
              </a>
            </Button>
          ) : (
            <p className="text-sm text-muted">Only admins can export all workspace data. Members can export leads as CSV on the Exports page.</p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Opt-out & erasure requests" description="When a business asks to be removed, open its lead and use “Suppress business data”, which deletes its contacts and blocks future collection." />
        <CardBody className="text-sm text-muted">
          Record the request date and outcome in a lead note for your records. See the{" "}
          <a href="/privacy" className="text-accent hover:underline">
            privacy policy
          </a>{" "}
          template.
        </CardBody>
      </Card>
      {hasRole(ctx, "owner") ? (
        <Card className="border-danger/30">
          <CardHeader title="Delete this workspace" description="Permanently deletes all leads, notes, tasks, rules, integrations and notifications in this workspace. This cannot be undone." />
          <CardBody>
            <ConfirmAction action={deleteWorkspaceAction} label="Delete workspace" triggerVariant="danger" triggerSize="md" title={`Delete “${ctx.workspace.name}”?`} description="Type the workspace name to confirm. Consider downloading an export first." confirmLabel="Delete permanently">
              <Field label="Workspace name" htmlFor="confirm-ws">
                <Input id="confirm-ws" name="confirm" autoComplete="off" required />
              </Field>
            </ConfirmAction>
          </CardBody>
        </Card>
      ) : null}
      <Card className="border-danger/30">
        <CardHeader title="Delete my account" description="Removes you from all workspaces, deletes workspaces where you are the only member, and anonymizes your account. Other members keep shared workspaces." />
        <CardBody>
          <ConfirmAction action={deleteAccountAction} label="Delete my account" triggerVariant="danger" triggerSize="md" title="Delete your account?" description="Enter your password and type DELETE to confirm." confirmLabel="Delete account">
            <Field label="Password" htmlFor="del-pw">
              <Input id="del-pw" name="password" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="Type DELETE" htmlFor="del-confirm">
              <Input id="del-confirm" name="confirm" autoComplete="off" required />
            </Field>
          </ConfirmAction>
        </CardBody>
      </Card>
    </div>
  );
}

async function AuditTab() {
  const ctx = await requireAuth();
  if (!hasRole(ctx, "admin")) return <Notice tone="warning">Only admins can view the audit log.</Notice>;
  const [logs, members] = await Promise.all([
    withTenant(ctx.workspace.id, (tx) => tx.select().from(schema.auditLogs).where(eq(schema.auditLogs.workspaceId, ctx.workspace.id)).orderBy(desc(schema.auditLogs.createdAt)).limit(200)),
    systemDb().select({ id: schema.users.id, name: schema.users.name }).from(schema.users).innerJoin(schema.memberships, and(eq(schema.memberships.userId, schema.users.id), eq(schema.memberships.workspaceId, ctx.workspace.id))),
  ]);
  const who = new Map(members.map((m) => [m.id, m.name]));
  return (
    <Card>
      <CardHeader title="Audit log" description="Important actions in this workspace (latest 200). Secrets are never logged." />
      {logs.length === 0 ? (
        <EmptyState title="No audit events yet" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Who</TH>
              <TH>Action</TH>
              <TH>Details</TH>
            </tr>
          </THead>
          <tbody>
            {logs.map((l) => (
              <TR key={l.id}>
                <TD className="whitespace-nowrap text-xs text-muted">{fmtDate(l.createdAt, true)}</TD>
                <TD className="text-xs">{l.userId ? (who.get(l.userId) ?? "Former member") : "System"}</TD>
                <TD>
                  <code className="font-mono text-xs">{l.action}</code>
                </TD>
                <TD className="max-w-md truncate font-mono text-[11px] text-muted" title={JSON.stringify(l.metadata)}>
                  {[l.targetType, l.targetId].filter(Boolean).join(":")} {Object.keys(l.metadata).length ? JSON.stringify(l.metadata) : ""}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
