import { and, eq } from "drizzle-orm";
import { schema, systemDb, withTenant } from "@/lib/db";
import type { NotificationPrefsShape } from "@/lib/db/schema";
import { enqueue } from "@/lib/jobs/queue";
import { emailDeliveryAvailable } from "./email";

export const NOTIFICATION_TYPES = {
  new_lead: "New matching business discovered",
  high_potential: "High-potential lead identified",
  new_website: "New business website detected",
  domain_opportunity: "Domain-related opportunity",
  announcement: "Relevant business announcement",
  new_contact: "New business contact information",
  job_failed: "Monitoring job failed",
  quota_warning: "Usage or API limit approaching",
  follow_up_due: "Follow-up reminder",
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const DEFAULT_PREFS: NotificationPrefsShape = {
  types: Object.fromEntries(Object.keys(NOTIFICATION_TYPES).map((k) => [k, true])),
  minScore: 0,
  countries: [],
  email: "off",
  browser: true,
  quietHours: { enabled: false, start: "22:00", end: "07:00", timezone: "UTC" },
};

export function mergePrefs(p: Partial<NotificationPrefsShape> | null | undefined): NotificationPrefsShape {
  return { ...DEFAULT_PREFS, ...p, types: { ...DEFAULT_PREFS.types, ...(p?.types ?? {}) }, quietHours: { ...DEFAULT_PREFS.quietHours, ...(p?.quietHours ?? {}) } };
}

/** Minutes until quiet hours end (0 if not currently quiet). */
export function quietDelayMinutes(q: NotificationPrefsShape["quietHours"], now = new Date()): number {
  if (!q.enabled) return 0;
  let local: Date;
  try {
    local = new Date(now.toLocaleString("en-US", { timeZone: q.timezone }));
  } catch {
    local = now;
  }
  const mins = local.getHours() * 60 + local.getMinutes();
  const [sh, sm] = q.start.split(":").map(Number);
  const [eh, em] = q.end.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const inQuiet = start <= end ? mins >= start && mins < end : mins >= start || mins < end;
  if (!inQuiet) return 0;
  return (end - mins + 1440) % 1440;
}

export type NotifyEvent = {
  type: NotificationType;
  title: string;
  body?: string;
  leadId?: string | null;
  sourceUrl?: string | null;
  /** Stable key so the same event never notifies twice. */
  dedupeKey: string;
  score?: number | null;
  countryCode?: string | null;
};

/**
 * Create in-app notifications for every workspace member whose preferences match,
 * and schedule email delivery (immediate, after quiet hours, or in the daily digest).
 */
export async function notify(workspaceId: string, ev: NotifyEvent): Promise<number> {
  const members = await systemDb()
    .select({ userId: schema.memberships.userId, prefs: schema.notificationPrefs.prefs })
    .from(schema.memberships)
    .leftJoin(schema.notificationPrefs, and(eq(schema.notificationPrefs.userId, schema.memberships.userId), eq(schema.notificationPrefs.workspaceId, workspaceId)))
    .where(eq(schema.memberships.workspaceId, workspaceId));
  let created = 0;
  for (const m of members) {
    const prefs = mergePrefs(m.prefs);
    if (prefs.types[ev.type] === false) continue;
    const scoreGated = ["new_lead", "high_potential", "new_website", "domain_opportunity", "announcement", "new_contact"].includes(ev.type);
    if (scoreGated && ev.score != null && ev.score < prefs.minScore) continue;
    if (scoreGated && prefs.countries.length && ev.countryCode && !prefs.countries.includes(ev.countryCode)) continue;
    const rows = await withTenant(workspaceId, (tx) =>
      tx
        .insert(schema.notifications)
        .values({ workspaceId, userId: m.userId, type: ev.type, title: ev.title, body: ev.body ?? null, leadId: ev.leadId ?? null, sourceUrl: ev.sourceUrl ?? null, dedupeKey: `${m.userId}:${ev.dedupeKey}` })
        .onConflictDoNothing()
        .returning({ id: schema.notifications.id }),
    );
    if (!rows.length) continue; // duplicate prevented
    created++;
    if (prefs.email === "immediate" && emailDeliveryAvailable()) {
      const delay = quietDelayMinutes(prefs.quietHours);
      await enqueue({ type: "send_notification_email", workspaceId, payload: { notificationId: rows[0].id }, runAt: new Date(Date.now() + delay * 60_000), idempotencyKey: `email:${rows[0].id}` });
    }
  }
  return created;
}
