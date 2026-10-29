import Link from "next/link";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { requireAuth } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";
import { NOTIFICATION_TYPES, mergePrefs } from "@/lib/notifications/notify";
import { smtpConfigured } from "@/lib/notifications/email";
import { PageHeader, Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Tabs, fmtDate, Pagination } from "@/components/ui/misc";
import { Select } from "@/components/ui/input";
import { PrefsForm } from "./prefs-form";
import { markReadAction } from "./actions";

export const metadata = { title: "Notifications" };

const PAGE = 30;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireAuth();
  const sp = await searchParams;
  const tab = sp.tab === "preferences" ? "preferences" : "inbox";
  const ws = ctx.workspace.id;
  const N = schema.notifications;
  const type = sp.type && sp.type in NOTIFICATION_TYPES ? sp.type : undefined;
  const unreadOnly = sp.unread === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const where = and(eq(N.workspaceId, ws), eq(N.userId, ctx.user.id), type ? eq(N.type, type) : undefined, unreadOnly ? isNull(N.readAt) : undefined);
  const [items, [{ total }], [{ unread }], prefRows] = await withTenant(ws, (tx) =>
    Promise.all([
      tx.select().from(N).where(where).orderBy(desc(N.createdAt)).limit(PAGE).offset((page - 1) * PAGE),
      tx.select({ total: sql<number>`count(*)::int` }).from(N).where(where),
      tx.select({ unread: sql<number>`count(*)::int` }).from(N).where(and(eq(N.workspaceId, ws), eq(N.userId, ctx.user.id), isNull(N.readAt))),
      tx.select().from(schema.notificationPrefs).where(and(eq(schema.notificationPrefs.workspaceId, ws), eq(schema.notificationPrefs.userId, ctx.user.id))),
    ]),
  );
  const qs = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ type, unread: unreadOnly ? "1" : undefined, ...p })) if (v) u.set(k, v);
    return `/app/notifications?${u}`;
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Alerts from monitoring rules, enrichment, job failures and usage limits. Each alert links to its lead and the supporting source."
        actions={
          tab === "inbox" && unread ? (
            <form action={markReadAction}>
              <input type="hidden" name="all" value="1" />
              <Button type="submit">Mark all as read</Button>
            </form>
          ) : null
        }
      />
      <Tabs
        active={tab}
        tabs={[
          { id: "inbox", label: "Inbox", href: "/app/notifications", count: unread },
          { id: "preferences", label: "Preferences", href: "/app/notifications?tab=preferences" },
        ]}
      />
      {tab === "preferences" ? (
        <Card>
          <CardBody>
            <PrefsForm prefs={mergePrefs(prefRows[0]?.prefs)} types={NOTIFICATION_TYPES} smtp={smtpConfigured()} />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <form method="get" action="/app/notifications" className="flex flex-wrap items-center gap-3 border-b border-border p-3">
            <label htmlFor="type" className="sr-only">
              Type
            </label>
            <Select id="type" name="type" defaultValue={type ?? ""} className="w-64">
              <option value="">All types</option>
              {Object.entries(NOTIFICATION_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="unread" value="1" defaultChecked={unreadOnly} className="size-4 accent-[var(--accent)]" /> Unread only
            </label>
            <Button type="submit" size="sm">
              Filter
            </Button>
          </form>
          {items.length === 0 ? (
            <EmptyState title="No notifications" description={type || unreadOnly ? "Nothing matches these filters." : "Create a monitoring rule with notifications turned on to get alerted about new qualifying businesses."} action={<Button asChild size="sm" variant="primary"><Link href="/app/monitoring">Monitoring rules</Link></Button>} />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li key={n.id} className={n.readAt ? "" : "bg-accent-soft/30"}>
                  <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {!n.readAt ? <span className="size-2 rounded-full bg-accent" aria-label="Unread" /> : null}
                        <p className="text-sm font-medium">{n.title}</p>
                        <Badge tone="outline">{NOTIFICATION_TYPES[n.type as keyof typeof NOTIFICATION_TYPES] ?? n.type}</Badge>
                      </div>
                      {n.body ? <p className="mt-0.5 text-sm text-muted">{n.body}</p> : null}
                      <p className="mt-1 flex flex-wrap gap-3 text-xs text-subtle">
                        <span>{fmtDate(n.createdAt, true)}</span>
                        {n.emailedAt ? <span>Emailed</span> : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {n.leadId ? (
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/app/leads/${n.leadId}`}>Open lead</Link>
                        </Button>
                      ) : null}
                      {n.sourceUrl ? (
                        <Button asChild size="sm" variant="ghost">
                          <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                            Source <ExternalLink />
                          </a>
                        </Button>
                      ) : null}
                      {!n.readAt ? (
                        <form action={markReadAction}>
                          <input type="hidden" name="ids" value={n.id} />
                          <Button type="submit" size="sm" variant="ghost">
                            Mark read
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {total > PAGE ? <Pagination page={page} pageSize={PAGE} total={total} hrefFor={(p) => qs({ page: String(p) })} /> : null}
        </Card>
      )}
    </>
  );
}
