import Link from "next/link";
import { requireAuth, hasRole } from "@/lib/auth/session";
import { SOCIAL_PLATFORMS, listConnections } from "@/lib/social/accounts";
import { getAutopilot } from "@/lib/social/service";
import { commentCounts } from "@/lib/social/engage";
import { nextSlot } from "@/lib/social/schedule";
import { fmtSlot } from "@/lib/social/format";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/states";
import { SocialNav } from "../nav";
import { ComposeForm } from "./compose-form";

export const metadata = { title: "Compose & publish" };

export default async function ComposePage() {
  const ctx = await requireAuth();
  const ws = ctx.workspace.id;
  const [ap, conns, cc] = await Promise.all([getAutopilot(ws), listConnections(ws), commentCounts(ws)]);
  const cfg = ap.config;
  const platforms = SOCIAL_PLATFORMS.map((p) => {
    const c = conns.find((x) => x.kind === "platform" && x.id === p.id);
    return { id: p.id, name: p.name, connected: !!c?.configured && !!c.enabled };
  });
  const connected = platforms.filter((p) => p.connected).map((p) => p.id);
  const defaults = cfg.platforms.filter((p) => connected.includes(p));
  const slot = cfg.scheduleMode === "slots" ? nextSlot(cfg.postingTimes, cfg.timezone, new Date(), []) : null;
  const publicUrl = !/localhost|127\.0\.0\.1/.test(process.env.APP_URL ?? "localhost");

  return (
    <>
      <PageHeader title="Compose & publish" description="Write your own post — title, description, content and images — and publish it as-is to all your connected accounts at once. Nothing is rewritten." />
      <SocialNav active="compose" counts={{ comments: cc.inbox }} />
      {!hasRole(ctx, "member") ? (
        <Card>
          <EmptyState title="Viewers cannot publish" description="Ask a workspace admin for member access." />
        </Card>
      ) : !connected.length ? (
        <Card>
          <EmptyState
            title="Connect an account first"
            description="Add at least one publishing account (Facebook Page, Instagram, Threads, Bluesky, Mastodon, Telegram, Discord or LinkedIn)."
            action={
              <Link href="/app/social/settings" className="font-medium text-accent hover:underline">
                Open settings
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {!publicUrl ? (
            <Notice tone="warning" className="mb-4">
              Images are served from APP_URL ({process.env.APP_URL ?? "not set"}), which is not public. Facebook, Instagram, Threads, Telegram and Discord need a public HTTPS address to fetch them; Bluesky and Mastodon uploads work either way.
            </Notice>
          ) : null}
          <Card>
            <CardBody>
              <ComposeForm platforms={platforms} defaultPlatforms={defaults.length ? defaults : connected} scheduleLabel={slot ? fmtSlot(slot, cfg.timezone) : null} />
            </CardBody>
          </Card>
          <p className="mt-3 text-xs text-muted">
            Instagram and Threads show up to 10 images as a carousel, Facebook as an album, Bluesky and Mastodon up to 4. LinkedIn gets the text and link. Comments on these posts appear under Comments, and their likes/shares under Analytics.
          </p>
        </>
      )}
    </>
  );
}
