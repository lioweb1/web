import type { HttpClient } from "./http";
import type { RuleCriteria } from "@/lib/db/schema";

export type SignalKind =
  | "business_launch"
  | "website_requirement"
  | "redesign_requirement"
  | "ecommerce_requirement"
  | "hosting_migration"
  | "general_update"
  | "new_registration"
  | "new_domain"
  | "no_website"
  | "website_issues";

export type DiscoveredSignal = {
  type: SignalKind;
  title: string;
  summary?: string | null;
  url?: string | null;
  externalId: string;
  publishedAt?: Date | null;
  matchedKeywords?: string[];
};

/** A business as reported by one source. Only fields the source actually provides are set. */
export type DiscoveredRecord = {
  externalKey: string;
  name: string;
  category?: string | null;
  industry?: string | null;
  businessType?: string | null;
  countryCode?: string | null;
  /** How the country was determined, e.g. "address" or "ccTLD (weak)". */
  countryEvidence?: string | null;
  region?: string | null;
  city?: string | null;
  address?: string | null;
  postcode?: string | null;
  lat?: number | null;
  lon?: number | null;
  websiteUrl?: string | null;
  /** True when the source affirmatively has no website for a business (e.g. OSM POI with no website tag). */
  noWebsiteListed?: boolean;
  phone?: string | null;
  email?: string | null;
  socials?: { type: "linkedin" | "facebook" | "instagram" | "x"; url: string }[];
  registrationDate?: string | null;
  sourcePublishedAt?: Date | null;
  sourceUrl: string;
  signals?: DiscoveredSignal[];
  domainObservation?: { domain: string; observedAt: Date | null; sourceRef: string } | null;
};

/** Signal not (yet) attributable to an identifiable business, e.g. an RSS item. */
export type DiscoveredUnattributedSignal = DiscoveredSignal & { providerId: string };

export type DiscoveryResult = {
  records: DiscoveredRecord[];
  unattributedSignals?: DiscoveredUnattributedSignal[];
  /** Human-readable notes about coverage limits of this run. */
  notes?: string[];
  requests: number;
};

export type ProviderContext = {
  http: HttpClient;
  secrets: Record<string, string>;
  settings: Record<string, unknown>;
  /** Only return records first seen / changed after this moment, when the source supports it. */
  since?: Date | null;
};

export type ProviderCategory =
  | "business_directory"
  | "company_registry"
  | "domain_intelligence"
  | "rdap"
  | "website_technology"
  | "contact_enrichment"
  | "startup_signals"
  | "social"
  | "email_verification"
  | "crm"
  | "news_feeds";

export type FieldDef = { key: string; label: string; type: "secret" | "text" | "textarea" | "checkbox"; help?: string; required?: boolean };

export type ProviderDefinition = {
  id: string;
  name: string;
  category: ProviderCategory;
  description: string;
  docsUrl: string;
  pricingNote: string;
  licenseNote: string;
  refreshNote: string;
  /** "periodic" sources must never be described as real-time. */
  updateMode: "periodic" | "on_demand";
  minIntervalMinutes: number;
  supportedCountries: "all" | string[];
  dataFields: string[];
  secretFields: FieldDef[];
  settingFields: FieldDef[];
  /** Usable without any configuration (still must be tested before showing "connected"). */
  worksWithoutKey: boolean;
  /** Key-less sources are enabled by default unless this is false. */
  defaultEnabled?: boolean;
  /** Not implementable with permitted access; shown with an explanation and alternatives. */
  unavailableReason?: string;
  /** Source reliability weight 0..1 used by scoring. */
  reliability: number;
  capabilities: { discovery?: boolean; enrichment?: boolean; signals?: boolean; crmPush?: boolean };
  /** Criteria fields this source can use, for the UI. */
  criteriaSupport?: (keyof RuleCriteria)[];
  test?: (ctx: ProviderContext) => Promise<{ ok: boolean; message: string; remainingQuota?: number | null }>;
  discover?: (ctx: ProviderContext, criteria: RuleCriteria) => Promise<DiscoveryResult>;
};
