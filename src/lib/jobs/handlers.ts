import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { schema, systemDb, withTenant } from "@/lib/db";
import type { RuleCriteria } from "@/lib/db/schema";
import { runDiscovery, existingLeadMap } from "@/lib/discovery/pipeline";
import { enrichBusiness, computeScore, rescoreLead } from "@/lib/services/enrich";
import { createLead } from "@/lib/services/leads";
import { notify } from "@/lib/notifications/notify";
import { sendEmail, appUrl } from "@/lib/notifications/email";
import { enqueue, type Job } from "./queue";
import { providerContext, httpClient } from "@/lib/services/integrations";
import { decryptSecret, hmacSha256 } from "@/lib/security/crypto";
import { scoreCategory } from "@/lib/scoring/score";
import { countryName } from "@/lib/countries";
import { isDemandSignal } from "@/lib/discovery/classify";
import { ProviderHttpError } from "@/lib/providers/http";
import { LimitExceededError } from "@/lib/plans";
import { pushLeadToHubspot } from "@/lib/services/crm";
import { runScan, publishPost, markPublishGivenUp, SocialConfigError } from "@/lib/social/service";
import { syncEngagement } from "@/lib/social/engage";
import { pollTelegram } from "@/lib/social/telegram";

export class PermanentJobError extends Error {}

export function isPermanent(e: unknown) {
  return e instanceof PermanentJobError || e instanceof LimitExceededError || e instanceof SocialConfigError || (e instanceof ProviderHttpError && !e.retryable);
}

type Handler = (job: Job) => Promise<Record<string, unknown>>;

const str = (v: unknown) => (typeof v === "string" ? v : "");

export const handlers: Record<string, Handler> = {
  async discovery_run(job) {
    const ws = job.workspaceId!;
    const p = job.payload as { providerId: string; criteria: RuleCriteria; ruleId?: string; since?: string };
    let rule: typeof schema.monitoringRules.$inferSelect | undefined;
    if (p.ruleId) {
      [rule] = await withTenant(ws, (tx) => tx.select().from(schema.monitoringRules).where(eq(schema.monitoringRules.id, p.ruleId!)));
      if (!rule) throw new PermanentJobError("Monitoring rule was deleted");
    }
    try {
      const res = await runDiscovery(ws, p.providerId, p.criteria, { since: p.since ? new Date(p.since) : null });
      let queued = 0;
      if (rule) {
        const existing = await withTenant(ws, (tx) => existingLeadMap(tx, ws, res.businessIds));
        for (const businessId of res.businessIds.filter((id) => !existing.has(id))) {
          const j = await enqueue({ type: "qualify_business", workspaceId: ws, payload: { ruleId: rule.id, businessId, providerId: p.providerId }, idempotencyKey: `qualify:${rule.id}:${businessId}` });
          if (j) queued++;
        }
        // Unattributed demand signals (e.g. "looking for a web developer" posts) notify directly.
        if (rule.notify) {
          const sigs = await withTenant(ws, (tx) =>
            tx.select().from(schema.businessSignals).where(and(eq(schema.businessSignals.workspaceId, ws), isNull(schema.businessSignals.businessId), eq(schema.businessSignals.providerId, p.providerId), gte(schema.businessSignals.discoveredAt, job.startedAt ?? new Date(0)))),
          );
          for (const s of sigs.filter((s) => isDemandSignal(s.type) || s.type === "business_launch"))
            await notify(ws, { type: "announcement", title: s.title, body: `Signal from ${p.providerId}: ${s.type.replace(/_/g, " ")}`, sourceUrl: s.url, dedupeKey: `signal:${s.id}` });
        }
        await withTenant(ws, (tx) =>
          tx.update(schema.monitoringRules).set({ lastRunAt: new Date(), lastSuccessAt: new Date(), lastError: null, lastRunStats: { fetched: res.fetched, matched: res.matched, new: res.newBusinesses, queued, signals: res.signals } }).where(eq(schema.monitoringRules.id, rule!.id)),
        );
      }
      return { ...res, businessIds: res.businessIds.slice(0, 1000), qualifyQueued: queued };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (rule) {
        await withTenant(ws, (tx) => tx.update(schema.monitoringRules).set({ lastRunAt: new Date(), lastError: msg.slice(0, 1000) }).where(eq(schema.monitoringRules.id, rule!.id)));
        if (isPermanent(e) || job.attempts >= job.maxAttempts)
          await notify(ws, { type: "job_failed", title: `Monitoring rule "${rule.name}" failed`, body: msg, dedupeKey: `jobfail:${job.id}` });
      }
      throw e;
    }
  },

  /** Enrich + score a newly discovered business against a rule; save and notify only if it qualifies. */
  async qualify_business(job) {
    const ws = job.workspaceId!;
    const { ruleId, businessId, providerId } = job.payload as { ruleId: string; businessId: string; providerId: string };
    const [rule] = await withTenant(ws, (tx) => tx.select().from(schema.monitoringRules).where(eq(schema.monitoringRules.id, ruleId)));
    if (!rule) throw new PermanentJobError("Monitoring rule was deleted");
    const enrich = await enrichBusiness(ws, businessId, { analyze: rule.autoAnalyzeWebsites });
    const outcome = await withTenant(ws, async (tx) => {
      const score = await computeScore(tx, ws, businessId, { countries: rule.criteria.countries, industries: rule.criteria.industries });
      const contacts = await tx.select().from(schema.contacts).where(eq(schema.contacts.businessId, businessId));
      const hasEmail = contacts.some((c) => c.type === "email" && c.verificationStatus !== "invalid");
      const hasPhone = contacts.some((c) => c.type === "phone");
      const contactOk = rule.contactRequirement === "none" || (rule.contactRequirement === "email" && hasEmail) || (rule.contactRequirement === "phone" && hasPhone) || (rule.contactRequirement === "any" && (hasEmail || hasPhone));
      if (score.score < rule.minScore || !contactOk) return { qualified: false as const, score: score.score, reason: !contactOk ? "contact requirement not met" : `score ${score.score} < ${rule.minScore}` };
      const { lead, created } = await createLead(tx, ws, businessId, { ruleId, providerId, summary: `Discovered by monitoring rule "${rule.name}" via ${providerId}` });
      await tx.update(schema.leads).set({ score: score.score, scoreFactors: score.factors, scoreConfidence: score.confidence, scoreMissing: score.missing, scoreNextStep: score.nextStep, scoredAt: new Date() }).where(eq(schema.leads.id, lead.id));
      for (const tagId of rule.autoTagIds) await tx.insert(schema.leadTags).values({ workspaceId: ws, leadId: lead.id, tagId }).onConflictDoNothing();
      if (rule.autoListId) await tx.insert(schema.leadListItems).values({ workspaceId: ws, listId: rule.autoListId, leadId: lead.id }).onConflictDoNothing();
      const [biz] = await tx.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
      return { qualified: true as const, created, lead, score, biz };
    });
    if (!outcome.qualified) return { qualified: false, score: outcome.score, reason: outcome.reason, enrichErrors: enrich.errors };
    const { lead, score, biz, created } = outcome;
    if (created && rule.notify) {
      const where = [biz.city, countryName(biz.countryCode)].filter(Boolean).join(", ");
      const [obs] = await withTenant(ws, (tx) => tx.select({ url: schema.sourceObservations.sourceUrl }).from(schema.sourceObservations).where(and(eq(schema.sourceObservations.businessId, businessId), eq(schema.sourceObservations.providerId, providerId))).limit(1));
      const type = providerId === "crtsh" ? "domain_opportunity" : biz.hasWebsite && providerId === "hackernews" ? "new_website" : "new_lead";
      await notify(ws, { type, title: `${biz.name}${where ? ` — ${where}` : ""}`, body: `Score ${score.score} (${scoreCategory(score.score)}). ${score.factors.filter((f) => f.points > 0).slice(0, 2).map((f) => f.evidence).join("; ")}`, leadId: lead.id, sourceUrl: obs?.url ?? null, dedupeKey: `lead:${lead.id}:new`, score: score.score, countryCode: biz.countryCode });
      if (score.score >= 75)
        await notify(ws, { type: "high_potential", title: `High-potential lead: ${biz.name}`, body: `Score ${score.score}/100 (${scoreCategory(score.score)})`, leadId: lead.id, sourceUrl: obs?.url ?? null, dedupeKey: `lead:${lead.id}:high`, score: score.score, countryCode: biz.countryCode });
    }
    if (created) await fireLeadEvent(ws, lead.id, "lead.created", score.score);
    if (created) {
      const hub = await providerContext(ws, "hubspot");
      if (hub.enabled && hub.configured && hub.settings.autoPush === "1") await enqueue({ type: "push_crm", workspaceId: ws, payload: { leadId: lead.id }, idempotencyKey: `hubspot:${lead.id}` });
    }
    return { qualified: true, created, leadId: lead.id, score: score.score, enrichErrors: enrich.errors };
  },

  async enrich_lead(job) {
    const ws = job.workspaceId!;
    const leadId = str(job.payload.leadId);
    const [lead] = await withTenant(ws, (tx) => tx.select().from(schema.leads).where(eq(schema.leads.id, leadId)));
    if (!lead) throw new PermanentJobError("Lead not found");
    const before = await withTenant(ws, (tx) => tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.businessId, lead.businessId)));
    const enrich = await enrichBusiness(ws, lead.businessId, { analyze: job.payload.analyze !== false });
    const after = await withTenant(ws, (tx) => tx.select().from(schema.contacts).where(eq(schema.contacts.businessId, lead.businessId)));
    const fresh = after.filter((c) => !before.some((b) => b.id === c.id) && ["email", "phone"].includes(c.type));
    const s = await rescoreLead(ws, leadId);
    if (fresh.length) {
      await notify(ws, { type: "new_contact", title: `New contact details found`, body: fresh.map((c) => `${c.type}: ${c.value}`).join(", "), leadId, sourceUrl: fresh[0].sourceUrl, dedupeKey: `contacts:${fresh.map((c) => c.id).sort().join(",")}`, score: s.score });
    }
    return { score: s.score, newContacts: fresh.length, errors: enrich.errors };
  },

  async send_notification_email(job) {
    const id = str(job.payload.notificationId);
    const ws = job.workspaceId!;
    const [n] = await withTenant(ws, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.id, id)));
    if (!n || !n.userId || n.emailedAt) return { skipped: true };
    const [u] = await systemDb().select().from(schema.users).where(eq(schema.users.id, n.userId));
    if (!u || u.deletedAt) return { skipped: true };
    const link = n.leadId ? appUrl(`/app/leads/${n.leadId}`) : appUrl("/app/notifications");
    await sendEmail({ to: u.email, subject: `[LeadOrbit] ${n.title}`, text: `${n.title}\n\n${n.body ?? ""}\n\nOpen: ${link}${n.sourceUrl ? `\nSource: ${n.sourceUrl}` : ""}\n\nManage alerts: ${appUrl("/app/notifications?tab=preferences")}` });
    await withTenant(ws, (tx) => tx.update(schema.notifications).set({ emailedAt: new Date() }).where(eq(schema.notifications.id, id)));
    return { sent: true };
  },

  async send_digest(job) {
    const ws = job.workspaceId!;
    const userId = str(job.payload.userId);
    const [u] = await systemDb().select().from(schema.users).where(eq(schema.users.id, userId));
    if (!u || u.deletedAt) return { skipped: true };
    const items = await withTenant(ws, (tx) =>
      tx.select().from(schema.notifications).where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.emailedAt), gte(schema.notifications.createdAt, new Date(Date.now() - 2 * 86400_000)))).orderBy(desc(schema.notifications.createdAt)).limit(50),
    );
    await withTenant(ws, (tx) => tx.update(schema.notificationPrefs).set({ lastDigestAt: new Date() }).where(and(eq(schema.notificationPrefs.userId, userId), eq(schema.notificationPrefs.workspaceId, ws))));
    if (!items.length) return { sent: false, reason: "nothing new" };
    const lines = items.map((n) => `• ${n.title}${n.body ? ` — ${n.body.slice(0, 140)}` : ""}\n  ${n.leadId ? appUrl(`/app/leads/${n.leadId}`) : appUrl("/app/notifications")}`);
    await sendEmail({ to: u.email, subject: `[LeadOrbit] Daily summary: ${items.length} update${items.length > 1 ? "s" : ""}`, text: `Your LeadOrbit daily summary\n\n${lines.join("\n\n")}\n\nManage alerts: ${appUrl("/app/notifications?tab=preferences")}` });
    await withTenant(ws, (tx) => tx.update(schema.notifications).set({ emailedAt: new Date() }).where(inArray(schema.notifications.id, items.map((i) => i.id))));
    return { sent: true, count: items.length };
  },

  async deliver_webhook(job) {
    const ws = job.workspaceId!;
    const { webhookId, body } = job.payload as { webhookId: string; body: string };
    const [hook] = await withTenant(ws, (tx) => tx.select().from(schema.webhooks).where(eq(schema.webhooks.id, webhookId)));
    if (!hook || !hook.active) return { skipped: true };
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = hmacSha256(decryptSecret(hook.encryptedSecret), `${ts}.${body}`);
    const { safeFetch, defaultResolver } = await import("@/lib/analysis/net");
    const res = await safeFetch(httpClient(), defaultResolverOverride ?? defaultResolver, hook.url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", "X-LeadOrbit-Timestamp": ts, "X-LeadOrbit-Signature": `sha256=${sig}` },
      timeoutMs: 15000,
    });
    await withTenant(ws, (tx) => tx.update(schema.webhooks).set({ lastDeliveryAt: new Date(), lastStatus: res.status }).where(eq(schema.webhooks.id, webhookId)));
    if (!res.ok) throw new ProviderHttpError(`Webhook endpoint returned HTTP ${res.status}`, res.status, res.status >= 500 || res.status === 429);
    return { status: res.status };
  },

  async push_crm(job) {
    return pushLeadToHubspot(job.workspaceId!, str(job.payload.leadId));
  },

  /** Social autopilot: find niche trends, draft posts and (in auto mode) queue them. */
  async social_scan(job) {
    const { errorMessages, ...stats } = await runScan(job.workspaceId!);
    return { ...stats, errors: errorMessages.slice(0, 10) };
  },

  async social_publish(job) {
    const ws = job.workspaceId!;
    const postId = str(job.payload.postId);
    try {
      return await publishPost(ws, postId, { finalAttempt: job.attempts >= job.maxAttempts });
    } catch (e) {
      if (isPermanent(e) || job.attempts >= job.maxAttempts) await markPublishGivenUp(ws, postId);
      throw e;
    }
  },

  /** Social autopilot: fetch new comments, draft/send AI replies, refresh post metrics. */
  async social_engage(job) {
    const { errorMessages, ...stats } = await syncEngagement(job.workspaceId!);
    return { ...stats, errors: errorMessages };
  },

  /** Social autopilot: act on Telegram approval buttons. */
  async social_telegram_poll(job) {
    return pollTelegram(job.workspaceId!);
  },

  /** Hourly: follow-up reminders for due tasks and lead follow-up dates. */
  async task_reminders() {
    const now = new Date();
    const dueTasks = await systemDb().select().from(schema.tasks).where(and(isNull(schema.tasks.completedAt), isNull(schema.tasks.reminderSentAt), lte(schema.tasks.dueAt, now))).limit(500);
    for (const t of dueTasks) {
      await notify(t.workspaceId, { type: "follow_up_due", title: `Follow-up due: ${t.title}`, leadId: t.leadId, dedupeKey: `task:${t.id}` });
      await systemDb().update(schema.tasks).set({ reminderSentAt: now }).where(eq(schema.tasks.id, t.id));
    }
    const dueLeads = await systemDb()
      .select({ id: schema.leads.id, workspaceId: schema.leads.workspaceId, followUpAt: schema.leads.followUpAt, name: schema.businesses.name })
      .from(schema.leads)
      .innerJoin(schema.businesses, eq(schema.businesses.id, schema.leads.businessId))
      .where(and(lte(schema.leads.followUpAt, now), gte(schema.leads.followUpAt, new Date(now.getTime() - 7 * 86400_000)), isNull(schema.leads.archivedAt)))
      .limit(500);
    for (const l of dueLeads) await notify(l.workspaceId, { type: "follow_up_due", title: `Follow up with ${l.name}`, leadId: l.id, dedupeKey: `followup:${l.id}:${l.followUpAt!.toISOString()}` });
    return { tasks: dueTasks.length, leads: dueLeads.length };
  },
};

let defaultResolverOverride: import("@/lib/analysis/net").Resolver | null = null;
export function setWebhookResolverForTests(r: import("@/lib/analysis/net").Resolver | null) {
  defaultResolverOverride = r;
}

/** Fan a lead event out to matching webhooks. */
export async function fireLeadEvent(workspaceId: string, leadId: string, event: "lead.created" | "lead.qualified" | "lead.status_changed", score: number, extra: Record<string, unknown> = {}) {
  const hooks = await withTenant(workspaceId, (tx) =>
    tx.select().from(schema.webhooks).where(and(eq(schema.webhooks.workspaceId, workspaceId), eq(schema.webhooks.active, true), sql`${event} = any(${schema.webhooks.events})`, lte(schema.webhooks.minScore, score))),
  );
  if (!hooks.length) return 0;
  const data = await withTenant(workspaceId, async (tx) => {
    const [row] = await tx.select({ lead: schema.leads, business: schema.businesses }).from(schema.leads).innerJoin(schema.businesses, eq(schema.businesses.id, schema.leads.businessId)).where(eq(schema.leads.id, leadId));
    const contacts = await tx.select().from(schema.contacts).where(eq(schema.contacts.businessId, row.business.id));
    return { row, contacts };
  });
  const b = data.row.business;
  const body = JSON.stringify({
    event,
    occurredAt: new Date().toISOString(),
    lead: { id: leadId, url: appUrl(`/app/leads/${leadId}`), status: data.row.lead.status, score: data.row.lead.score, scoreFactors: data.row.lead.scoreFactors, ...extra },
    business: { name: b.name, website: b.websiteUrl, domain: b.domain, country: b.countryCode, city: b.city, industry: b.industry, category: b.category, registrationDate: b.registrationDate },
    contacts: data.contacts.map((c) => ({ type: c.type, value: c.value, verificationStatus: c.verificationStatus, source: c.sourceUrl })),
  });
  for (const h of hooks) await enqueue({ type: "deliver_webhook", workspaceId, payload: { webhookId: h.id, body }, maxAttempts: 6 });
  return hooks.length;
}
