import { ExternalLink } from "lucide-react";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { PROVIDERS } from "@/lib/providers/registry";
import { listIntegrations } from "@/lib/services/integrations";
import { PageHeader, Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/states";
import { fmtDate, fmtRelative } from "@/components/ui/misc";
import { countryName } from "@/lib/countries";
import { IntegrationForm } from "./integration-form";

export const metadata = { title: "Data sources" };

const CATEGORY: Record<string, string> = {
  business_directory: "Business directory",
  company_registry: "Company registry",
  domain_intelligence: "Domain intelligence",
  rdap: "RDAP",
  website_technology: "Website technology",
  contact_enrichment: "Contact enrichment",
  startup_signals: "Startup signals",
  social: "Social platform",
  email_verification: "Email verification",
  crm: "CRM",
  news_feeds: "News & feeds",
};

export default async function IntegrationsPage() {
  const ctx = await requireAuth();
  const rows = await listIntegrations(ctx.workspace.id);
  const canEdit = hasRole(ctx, "admin");
  return (
    <>
      <PageHeader
        title="Data sources"
        description="Every built-in source is free to use. A source is only shown as Connected after a connection test passes. API keys are encrypted at rest and never sent to the browser."
      />
      <Notice className="mb-6">
        Coverage depends on what each source publishes. OpenStreetMap covers mapped local businesses worldwide, Companies House covers the UK only, and Certificate Transparency only sees sites using HTTPS. LeadOrbit does not claim global coverage beyond what these sources contain.
      </Notice>
      <div className="grid gap-4 xl:grid-cols-2">
        {PROVIDERS.map((p) => {
          const row = rows.find((r) => r.providerId === p.id);
          const enabled = row ? row.enabled : p.worksWithoutKey && !p.unavailableReason && p.defaultEnabled !== false;
          const configured =
            p.secretFields.every((f) => !f.required || !!row?.maskedSecrets[f.key]) && p.settingFields.every((f) => !f.required || !!row?.settings?.[f.key]);
          const status = p.unavailableReason ? "unavailable" : (row?.connectionStatus ?? "untested");
          return (
            <Card key={p.id} id={p.id}>
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">{p.name}</h2>
                    <p className="text-xs text-muted">{CATEGORY[p.category] ?? p.category}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {status === "unavailable" ? (
                      <Badge tone="neutral">Not available</Badge>
                    ) : status === "connected" ? (
                      <Badge tone="success">Connected</Badge>
                    ) : status === "error" ? (
                      <Badge tone="danger">Test failed</Badge>
                    ) : (
                      <Badge tone="outline">Not tested</Badge>
                    )}
                    {!p.unavailableReason ? enabled ? <Badge tone="accent">Enabled</Badge> : <Badge>Disabled</Badge> : null}
                    {!p.unavailableReason ? configured ? <Badge tone="outline">Configured</Badge> : <Badge tone="warning">Needs configuration</Badge> : null}
                  </div>
                </div>
                <p className="text-sm text-fg/90">{p.description}</p>
                {p.unavailableReason ? <Notice tone="warning">{p.unavailableReason}</Notice> : null}
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                  <Item label="Pricing">{p.pricingNote}</Item>
                  <Item label="License / terms">{p.licenseNote}</Item>
                  <Item label="Refresh">
                    {p.updateMode === "periodic" ? "Periodic" : "On demand"}
                    {p.minIntervalMinutes ? ` · minimum interval ${p.minIntervalMinutes} min` : ""}. {p.refreshNote}
                  </Item>
                  <Item label="Supported countries">{p.supportedCountries === "all" ? "All countries the source covers" : p.supportedCountries.map(countryName).join(", ")}</Item>
                  <Item label="Data fields">{p.dataFields.join(", ")}</Item>
                  {!p.unavailableReason ? (
                    <>
                      <Item label="Last successful request">{row?.lastSuccessAt ? `${fmtDate(row.lastSuccessAt, true)} (${fmtRelative(row.lastSuccessAt)})` : "Never"}</Item>
                      <Item label="Last test">{row?.lastTestedAt ? fmtDate(row.lastTestedAt, true) : "Never tested"}</Item>
                      <Item label="Requests today">{row?.requestsToday ?? 0}</Item>
                      <Item label="Remaining quota">{row?.remainingQuota ?? "Not reported by provider"}</Item>
                      <Item label="Last error">
                        {row?.lastError ? (
                          <span className="text-danger">
                            {row.lastError} {row.lastErrorAt ? <span className="text-muted">({fmtRelative(row.lastErrorAt)})</span> : null}
                          </span>
                        ) : (
                          "None"
                        )}
                      </Item>
                    </>
                  ) : null}
                  <Item label="Documentation">
                    <a href={p.docsUrl} target={p.docsUrl.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                      {p.docsUrl.startsWith("http") ? new URL(p.docsUrl).hostname : "Help"} <ExternalLink className="size-3" />
                    </a>
                  </Item>
                </dl>
                {!p.unavailableReason ? (
                  <div className="border-t border-border pt-4">
                    <IntegrationForm
                      providerId={p.id}
                      enabled={enabled}
                      settingFields={p.settingFields}
                      secretFields={p.secretFields}
                      settings={Object.fromEntries(Object.entries(row?.settings ?? {}).map(([k, v]) => [k, String(v ?? "")]))}
                      masked={row?.maskedSecrets ?? {}}
                      canEdit={canEdit}
                      hasTest={!!p.test}
                    />
                  </div>
                ) : null}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 text-fg">{children}</dd>
    </div>
  );
}
