import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  doublePrecision,
  date,
  uniqueIndex,
  index,
  primaryKey,
  bigint,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/* Enums                                                                */
/* ------------------------------------------------------------------ */

export const memberRole = pgEnum("member_role", ["owner", "admin", "member", "viewer"]);
export const planTier = pgEnum("plan_tier", ["free", "pro", "agency"]);
export const leadStatus = pgEnum("lead_status", [
  "new",
  "reviewed",
  "qualified",
  "contacted",
  "follow_up",
  "replied",
  "meeting",
  "won",
  "lost",
  "not_interested",
]);
export const leadPriority = pgEnum("lead_priority", ["low", "medium", "high", "urgent"]);
export const contactType = pgEnum("contact_type", [
  "email",
  "phone",
  "website",
  "contact_page",
  "linkedin",
  "facebook",
  "instagram",
  "x",
]);
/** Kept deliberately distinct: syntax/MX checks never become "verified". */
export const verificationStatus = pgEnum("verification_status", [
  "verified_by_provider",
  "domain_valid",
  "unverified",
  "invalid",
  "unknown",
]);
export const signalType = pgEnum("signal_type", [
  "business_launch",
  "website_requirement",
  "redesign_requirement",
  "ecommerce_requirement",
  "hosting_migration",
  "general_update",
  "new_registration",
  "new_domain",
  "no_website",
  "website_issues",
]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "dead", "cancelled"]);
export const ruleFrequency = pgEnum("rule_frequency", ["manual", "hourly", "daily", "weekly", "custom"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/* ------------------------------------------------------------------ */
/* Identity, workspaces, access                                         */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    defaultWorkspaceId: uuid("default_workspace_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** sha256 of the opaque cookie token; the raw token is never stored. */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: planTier("plan").notNull().default("free"),
  /** Overrides of plan limits, configurable without code changes. */
  limitOverrides: jsonb("limit_overrides").$type<Record<string, number>>().notNull().default({}),
  defaultTargetMarketId: uuid("default_target_market_id"),
  settings: jsonb("settings").$type<WorkspaceSettings>().notNull().default({}),
  ...timestamps,
});

export type WorkspaceSettings = {
  /** Technologies the workspace builds with; used by the technology-compatibility score factor. */
  preferredTechnologies?: string[];
  /** Industries the workspace targets; used by the industry-relevance score factor. */
  targetIndustries?: string[];
  /** Services the workspace offers (shown in recommendations). */
  services?: string[];
};

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_ws_idx").on(t.workspaceId, t.createdAt)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Target markets                                                       */
/* ------------------------------------------------------------------ */

export const targetMarkets = pgTable(
  "target_markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "premium" | "all" | "custom" */
    mode: text("mode").notNull().default("custom"),
    countries: text("countries").array().notNull().default(sql`'{}'::text[]`),
    regions: text("regions").array().notNull().default(sql`'{}'::text[]`),
    cities: text("cities").array().notNull().default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (t) => [index("target_markets_ws_idx").on(t.workspaceId)],
);

/* ------------------------------------------------------------------ */
/* Canonical business data (shared, provenance-tracked)                 */
/* ------------------------------------------------------------------ */

/**
 * One canonical record per real-world business. Public-source businesses have
 * owner_workspace_id = NULL and are shared; records created by a CSV import are
 * private to the importing workspace (enforced by RLS).
 */
export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerWorkspaceId: uuid("owner_workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    category: text("category"),
    industry: text("industry"),
    businessType: text("business_type"),
    sizeBand: text("size_band"),
    countryCode: text("country_code"),
    region: text("region"),
    city: text("city"),
    address: text("address"),
    postcode: text("postcode"),
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    websiteUrl: text("website_url"),
    domain: text("domain"),
    hasWebsite: boolean("has_website"),
    /** Dedupe keys from upstream sources, e.g. "osm:node/123", "companies_house:01234567". */
    externalKeys: text("external_keys").array().notNull().default(sql`'{}'::text[]`),
    /** Only set when a source explicitly states it (e.g. company incorporation date). */
    registrationDate: date("registration_date"),
    registrationSource: text("registration_source"),
    sourcePublishedAt: timestamp("source_published_at", { withTimezone: true }),
    firstDiscoveredAt: timestamp("first_discovered_at", { withTimezone: true }).notNull().defaultNow(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    mergedIntoId: uuid("merged_into_id"),
    ...timestamps,
  },
  (t) => [
    index("businesses_domain_idx").on(t.domain),
    index("businesses_country_idx").on(t.countryCode),
    index("businesses_norm_name_idx").on(t.normalizedName, t.countryCode, t.city),
    index("businesses_ext_keys_idx").using("gin", t.externalKeys),
    index("businesses_owner_idx").on(t.ownerWorkspaceId),
  ],
);

/** Field-level provenance: every value we store came from somewhere, at some time. */
export const sourceObservations = pgTable(
  "source_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    field: text("field").notNull(),
    value: text("value"),
    sourceUrl: text("source_url"),
    sourceRef: text("source_ref"),
    sourcePublishedAt: timestamp("source_published_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("obs_business_idx").on(t.businessId, t.field)],
);

export const domains = pgTable(
  "domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domain: text("domain").notNull(),
    tld: text("tld").notNull(),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "set null" }),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    registrar: text("registrar"),
    rdapStatus: text("rdap_status").array(),
    firstDiscoveredAt: timestamp("first_discovered_at", { withTimezone: true }).notNull().defaultNow(),
    discoveryProvider: text("discovery_provider").notNull(),
    sourceRef: text("source_ref"),
    dnsA: text("dns_a").array(),
    dnsMx: text("dns_mx").array(),
    sslStatus: text("ssl_status"),
    sslIssuer: text("ssl_issuer"),
    sslValidTo: timestamp("ssl_valid_to", { withTimezone: true }),
    websiteStatus: text("website_status"),
    websiteHttpStatus: integer("website_http_status"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastRdapAt: timestamp("last_rdap_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("domains_domain_uq").on(t.domain), index("domains_discovered_idx").on(t.firstDiscoveredAt)],
);

export const websiteAnalyses = pgTable(
  "website_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    finalUrl: text("final_url"),
    httpStatus: integer("http_status"),
    reachable: boolean("reachable").notNull(),
    https: boolean("https"),
    responseMs: integer("response_ms"),
    pageBytes: integer("page_bytes"),
    title: text("title"),
    technologies: jsonb("technologies").$type<{ name: string; category: string; evidence: string }[]>().notNull().default([]),
    issues: jsonb("issues")
      .$type<{ code: string; label: string; kind: "measured" | "heuristic"; severity: "low" | "medium" | "high"; evidence: string }[]>()
      .notNull()
      .default([]),
    opportunities: jsonb("opportunities")
      .$type<{ title: string; evidence: string[]; service: string; confidence: "low" | "medium" | "high" }[]>()
      .notNull()
      .default([]),
    metrics: jsonb("metrics").$type<Record<string, number | string | boolean | null>>().notNull().default({}),
    error: text("error"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wa_business_idx").on(t.businessId, t.analyzedAt)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    type: contactType("type").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    label: text("label"),
    /** Publicly listed business role only (e.g. "Sales"). Never personal data beyond what is published. */
    role: text("role"),
    providerId: text("provider_id").notNull(),
    sourceUrl: text("source_url"),
    verificationStatus: verificationStatus("verification_status").notNull().default("unverified"),
    verificationDetail: text("verification_detail"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("contacts_uq").on(t.businessId, t.type, t.normalizedValue)],
);

export const businessSignals = pgTable(
  "business_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    type: signalType("type").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    url: text("url"),
    providerId: text("provider_id").notNull(),
    externalId: text("external_id").notNull(),
    /** When the source published it (post date, incorporation date...). */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
    matchedKeywords: text("matched_keywords").array().notNull().default(sql`'{}'::text[]`),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("signals_ext_uq").on(t.workspaceId, t.providerId, t.externalId), index("signals_business_idx").on(t.businessId)],
);

/* ------------------------------------------------------------------ */
/* Workspace-private CRM                                                */
/* ------------------------------------------------------------------ */

export type ScoreFactor = {
  key: string;
  label: string;
  points: number;
  max: number;
  evidence: string | null;
};

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    status: leadStatus("status").notNull().default("new"),
    priority: leadPriority("priority").notNull().default("medium"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    score: integer("score").notNull().default(0),
    scoreFactors: jsonb("score_factors").$type<ScoreFactor[]>().notNull().default([]),
    scoreConfidence: text("score_confidence").notNull().default("low"),
    scoreMissing: text("score_missing").array().notNull().default(sql`'{}'::text[]`),
    scoreNextStep: text("score_next_step"),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    discoveredByRuleId: uuid("discovered_by_rule_id"),
    discoveryProvider: text("discovery_provider"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("leads_ws_business_uq").on(t.workspaceId, t.businessId),
    index("leads_ws_status_idx").on(t.workspaceId, t.status),
    index("leads_ws_score_idx").on(t.workspaceId, t.score),
    index("leads_ws_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("slate"),
  },
  (t) => [uniqueIndex("tags_ws_name_uq").on(t.workspaceId, sql`lower(${t.name})`)],
);

export const leadTags = pgTable(
  "lead_tags",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.tagId] })],
);

export const leadLists = pgTable("lead_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  ...timestamps,
});

export const leadListItems = pgTable(
  "lead_list_items",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => leadLists.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.leadId] })],
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    ...timestamps,
  },
  (t) => [index("notes_lead_idx").on(t.leadId)],
);

/** Activity timeline: status changes, communication log, discovery events. */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** status_change | note | email | call | meeting | message | discovery | score | merge | task | system */
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activities_lead_idx").on(t.leadId, t.occurredAt)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("tasks_ws_due_idx").on(t.workspaceId, t.dueAt)],
);

/* ------------------------------------------------------------------ */
/* Integrations, monitoring, jobs                                       */
/* ------------------------------------------------------------------ */

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /** AES-256-GCM encrypted JSON of secrets (API keys). Never sent to the browser. */
    encryptedSecrets: text("encrypted_secrets"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    /** untested | connected | error */
    connectionStatus: text("connection_status").notNull().default("untested"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),
    requestsToday: integer("requests_today").notNull().default(0),
    requestsDay: date("requests_day"),
    remainingQuota: integer("remaining_quota"),
    ...timestamps,
  },
  (t) => [uniqueIndex("integrations_ws_provider_uq").on(t.workspaceId, t.providerId)],
);

export type RuleCriteria = {
  keyword?: string;
  countries?: string[];
  cities?: string[];
  industries?: string[];
  businessTypes?: string[];
  categories?: string[];
  websiteState?: "any" | "has_website" | "no_website";
  tlds?: string[];
};

export const monitoringRules = pgTable(
  "monitoring_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    providerIds: text("provider_ids").array().notNull(),
    criteria: jsonb("criteria").$type<RuleCriteria>().notNull().default({}),
    minScore: integer("min_score").notNull().default(0),
    /** none | email | phone | any */
    contactRequirement: text("contact_requirement").notNull().default("none"),
    autoAnalyzeWebsites: boolean("auto_analyze_websites").notNull().default(true),
    autoTagIds: uuid("auto_tag_ids").array().notNull().default(sql`'{}'::uuid[]`),
    autoListId: uuid("auto_list_id"),
    notify: boolean("notify").notNull().default(true),
    frequency: ruleFrequency("frequency").notNull().default("daily"),
    customIntervalMinutes: integer("custom_interval_minutes"),
    active: boolean("active").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastRunStats: jsonb("last_run_stats").$type<Record<string, number>>(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("rules_due_idx").on(t.active, t.nextRunAt)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(4),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    idempotencyKey: text("idempotency_key"),
    lastError: text("last_error"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("jobs_claim_idx").on(t.status, t.runAt),
    index("jobs_ws_idx").on(t.workspaceId, t.createdAt),
    uniqueIndex("jobs_idem_uq").on(t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notifications_dedupe_uq").on(t.workspaceId, t.dedupeKey), index("notifications_ws_idx").on(t.workspaceId, t.createdAt)],
);

export type NotificationPrefsShape = {
  types: Record<string, boolean>;
  minScore: number;
  countries: string[];
  email: "off" | "immediate" | "daily";
  browser: boolean;
  quietHours: { enabled: boolean; start: string; end: string; timezone: string };
};

export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    prefs: jsonb("prefs").$type<NotificationPrefsShape>().notNull(),
    lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  /** lead.created | lead.qualified | lead.status_changed */
  events: text("events").array().notNull(),
  minScore: integer("min_score").notNull().default(0),
  encryptedSecret: text("encrypted_secret").notNull(),
  active: boolean("active").notNull().default(true),
  lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
  lastStatus: integer("last_status"),
  ...timestamps,
});

export const savedSearches = pgTable("saved_searches", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  /** "leads" filters (URL query string) */
  query: text("query").notNull(),
  ...timestamps,
});

export const searchHistory = pgTable(
  "search_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    query: text("query").notNull(),
    resultCount: integer("result_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("search_history_idx").on(t.workspaceId, t.userId, t.createdAt)],
);

export const exportsLog = pgTable("exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  format: text("format").notNull(),
  rowCount: integer("row_count").notNull(),
  fields: text("fields").array().notNull(),
  filters: text("filters"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usageRecords = pgTable(
  "usage_records",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    /** YYYY-MM */
    period: text("period").notNull(),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.metric, t.period] })],
);

/* ------------------------------------------------------------------ */
/* Social autopilot                                                     */
/* ------------------------------------------------------------------ */

export type SocialAutopilotConfig = {
  /** Niche keywords; a trend item must mention at least one. */
  keywords: string[];
  /** Trend sources: hackernews | google_news | reddit | bluesky | rss */
  sources: string[];
  subreddits: string[];
  feeds: string[];
  /** Platforms to publish to (see SOCIAL_PLATFORMS). */
  platforms: string[];
  /** gemini | groq | openrouter | ollama */
  aiProvider: string;
  brandName: string;
  /** Free-text brand voice / product description used in the prompt. */
  brandVoice: string;
  link: string;
  /** Language of generated posts, e.g. "English" or "Bangla". */
  language: string;
  /** "approve" keeps drafts for review; "auto" publishes immediately. */
  mode: "approve" | "auto";
  maxPostsPerDay: number;
  /** Max drafts generated per scan. */
  draftsPerScan: number;
  /** "slots" publishes at the next posting time; "immediate" publishes right away. */
  scheduleMode: "slots" | "immediate";
  /** Local posting times, "HH:MM". */
  postingTimes: string[];
  /** IANA time zone for posting times, e.g. "Asia/Dhaka". */
  timezone: string;
  /** Comment replies: off, drafted for approval, or sent automatically. */
  autoReply: "off" | "approve" | "auto";
  maxRepliesPerDay: number;
  /** Give each platform a different hook variant (A/B test). */
  rotateHooks: boolean;
  /** Post a multi-part thread on Bluesky and Threads. */
  threadMode: boolean;
  /** Generate a branded image card when a post has no image. */
  autoImage: boolean;
  brandColor: string;
  /** Add utm_source/medium/campaign to the link. */
  utm: boolean;
};

export const socialAutopilots = pgTable("social_autopilots", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(false),
  config: jsonb("config").$type<SocialAutopilotConfig>().notNull(),
  intervalMinutes: integer("interval_minutes").notNull().default(180),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastRunStats: jsonb("last_run_stats").$type<Record<string, number>>(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  engageSyncedAt: timestamp("engage_synced_at", { withTimezone: true }),
  metricsSyncedAt: timestamp("metrics_synced_at", { withTimezone: true }),
  /** Telegram getUpdates offset for draft approvals. */
  telegramOffset: bigint("telegram_offset", { mode: "number" }),
  ...timestamps,
});

export type SocialMetrics = { likes: number; comments: number; shares: number; views?: number | null };

export type SocialPublishResult = {
  ok: boolean;
  url?: string | null;
  id?: string | null;
  /** Content id some platforms need for replies (Bluesky cid). */
  cid?: string | null;
  error?: string | null;
  at: string;
  /** Which hook variant was used on this platform. */
  hookIndex?: number;
  metrics?: SocialMetrics | null;
};

export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Trend source (hackernews, reddit…) or "manual". */
    sourceId: text("source_id").notNull(),
    sourceExternalId: text("source_external_id"),
    sourceTitle: text("source_title"),
    sourceUrl: text("source_url"),
    hook: text("hook").notNull(),
    body: text("body").notNull(),
    /** Short version for character-limited platforms (Bluesky, Threads, Mastodon). */
    shortBody: text("short_body").notNull(),
    /** Alternative hooks for A/B tests; `hook` is the chosen one. */
    hookVariants: text("hook_variants").array().notNull().default(sql`'{}'::text[]`),
    /** Platform-specific versions (linkedin, instagram) written in that platform's style. */
    platformTexts: jsonb("platform_texts").$type<Record<string, string>>().notNull().default({}),
    /** Follow-up parts for thread mode on Bluesky/Threads. */
    thread: text("thread").array().notNull().default(sql`'{}'::text[]`),
    primaryKeyword: text("primary_keyword"),
    altText: text("alt_text"),
    autoImage: boolean("auto_image").notNull().default(true),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    metricsUpdatedAt: timestamp("metrics_updated_at", { withTimezone: true }),
    /** Telegram message carrying the approval buttons. */
    approvalMessageId: bigint("approval_message_id", { mode: "number" }),
    engagementComment: text("engagement_comment"),
    hashtags: text("hashtags").array().notNull().default(sql`'{}'::text[]`),
    imageUrl: text("image_url"),
    platforms: text("platforms").array().notNull(),
    /** draft | queued | publishing | published | partial | failed | rejected */
    status: text("status").notNull().default("draft"),
    results: jsonb("results").$type<Record<string, SocialPublishResult>>().notNull().default({}),
    aiProvider: text("ai_provider"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("social_posts_ws_idx").on(t.workspaceId, t.createdAt),
    uniqueIndex("social_posts_source_uq").on(t.workspaceId, t.sourceExternalId).where(sql`${t.sourceExternalId} is not null`),
  ],
);

export const socialComments = pgTable(
  "social_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    /** Bluesky cid of the comment (needed to reply). */
    externalCid: text("external_cid"),
    authorHandle: text("author_handle"),
    authorName: text("author_name"),
    text: text("text").notNull(),
    url: text("url"),
    commentedAt: timestamp("commented_at", { withTimezone: true }),
    replyText: text("reply_text"),
    /** new | drafted | queued | replied | ignored | failed */
    status: text("status").notNull().default("new"),
    replyId: text("reply_id"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    error: text("error"),
    approvalMessageId: bigint("approval_message_id", { mode: "number" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("social_comments_ext_uq").on(t.workspaceId, t.platform, t.externalId), index("social_comments_ws_idx").on(t.workspaceId, t.status, t.createdAt)],
);
