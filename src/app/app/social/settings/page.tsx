import { ExternalLink } from "lucide-react";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { AI_PROVIDERS, SOCIAL_PLATFORMS, listConnections, type SocialConnectionDef } from "@/lib/social/accounts";
import { getAutopilot } from "@/lib/social/service";
import { TREND_SOURCES } from "@/lib/social/trends";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/states";
import { fmtDate } from "@/components/ui/misc";
import { AutopilotForm, ConnectionForm } from "../forms";
import { SocialNav } from "../nav";

export const metadata = { title: "Social autopilot settings" };

export default async function SocialSettingsPage() {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const [ap, conns] = await Promise.all([getAutopilot(ws), listConnections(ws)]);
  const canEdit = hasRole(ctx, "admin");
  const view = (d: SocialConnectionDef) => conns.find((c) => c.kind === d.kind && c.id === d.id)!;
  const statusText = (d: SocialConnectionDef) => {
    const v = view(d);
    return !v.configured ? "not set up" : v.connectionStatus === "connected" ? "connected" : v.connectionStatus === "error" ? "test failed" : "not tested";
  };

  return (
    <>
      <PageHeader
        title="Social autopilot settings"
        description="Everything here is free: trends come from public feeds and APIs, posts are written by a free-tier AI, and publishing uses each platform's official API."
      />
      <SocialNav active="settings" />
      <Card className="mb-6">
        <CardHeader title="Autopilot" description="What to look for, how to write, and where to post." />
        <CardBody>
          <AutopilotForm
            active={ap.active}
            intervalMinutes={ap.intervalMinutes}
            config={ap.config}
            sources={TREND_SOURCES.map((s) => ({ id: s.id, name: s.name, note: s.note }))}
            platforms={SOCIAL_PLATFORMS.map((p) => ({ id: p.id, name: p.name, status: statusText(p) }))}
            aiProviders={AI_PROVIDERS.map((p) => ({ id: p.id, name: p.name, status: statusText(p) }))}
            canEdit={canEdit}
          />
        </CardBody>
      </Card>

      <Notice className="mb-4">
        Keys and tokens are encrypted at rest and never sent to the browser. Posts are original AI rewrites of a trend&apos;s topic; they never copy or impersonate the original author. Keep the daily limit modest so platforms do not flag your accounts as spam.
      </Notice>

      {ap.config.autoImage && /localhost|127\.0\.0\.1/.test(process.env.APP_URL ?? "localhost") ? (
        <Notice tone="warning" className="mb-4">
          Branded image cards are served from APP_URL, which is not public right now ({process.env.APP_URL ?? "not set"}). Facebook, Instagram and Threads can only fetch them once the app runs on a public domain.
        </Notice>
      ) : null}

      <h2 className="mb-3 text-base font-semibold">AI writer</h2>
      <div className="mb-8 grid gap-4 xl:grid-cols-2">
        {AI_PROVIDERS.map((d) => (
          <ConnectionCard key={d.id} def={d} view={view(d)} canEdit={canEdit} selected={ap.config.aiProvider === d.id} />
        ))}
      </div>

      <h2 className="mb-3 text-base font-semibold">Publishing accounts</h2>
      <div className="grid gap-4 xl:grid-cols-2">
        {SOCIAL_PLATFORMS.map((d) => (
          <ConnectionCard key={d.id} def={d} view={view(d)} canEdit={canEdit} />
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">
        X (Twitter) is not included: its API charges for posting volume, and automating it without the API breaks its rules and risks a ban. TikTok and YouTube need video, and Pinterest needs an approved app and an image per pin.
      </p>
    </>
  );
}

function ConnectionCard({ def, view, canEdit, selected }: { def: SocialConnectionDef; view: Awaited<ReturnType<typeof listConnections>>[number]; canEdit: boolean; selected?: boolean }) {
  return (
    <Card id={`${def.kind}-${def.id}`}>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{def.name}</h3>
            <p className="text-xs text-muted">{def.pricingNote}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selected ? <Badge tone="accent">Selected writer</Badge> : null}
            {view.connectionStatus === "connected" ? <Badge tone="success">Connected</Badge> : view.connectionStatus === "error" ? <Badge tone="danger">Test failed</Badge> : <Badge tone="outline">Not tested</Badge>}
            {def.kind === "platform" && view.configured ? view.enabled ? <Badge tone="accent">Enabled</Badge> : <Badge>Disabled</Badge> : null}
            {!view.configured && def.secretFields.length ? <Badge tone="warning">Needs setup</Badge> : null}
          </div>
        </div>
        <p className="text-sm text-fg/90">{def.description}</p>
        <p className="text-xs">
          <a href={def.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
            Setup guide: {new URL(def.docsUrl).hostname} <ExternalLink className="size-3" />
          </a>
          {view.lastTestedAt ? <span className="text-muted"> · last tested {fmtDate(view.lastTestedAt, true)}</span> : null}
        </p>
        {view.lastError && view.connectionStatus === "error" ? <p className="text-xs text-danger">{view.lastError}</p> : null}
        <div className="border-t border-border pt-3">
          <ConnectionForm kind={def.kind} id={def.id} enabled={view.enabled} settingFields={def.settingFields} secretFields={def.secretFields} settings={view.settings} masked={view.maskedSecrets} canEdit={canEdit} />
        </div>
      </CardBody>
    </Card>
  );
}
