import type { ProviderDefinition } from "./types";
import { assertOk } from "./http";

export const websiteAnalyzerProvider: ProviderDefinition = {
  id: "website_analyzer",
  name: "Website analyzer (built-in)",
  category: "website_technology",
  description:
    "Fetches a business's public homepage (respecting robots.txt) to detect CMS/eCommerce/hosting technologies, SSL, metadata, mobile viewport, accessibility basics and broken links, and extracts contact details the business publishes.",
  docsUrl: "/app/help#website-analysis",
  pricingNote: "Free — runs on your own server.",
  licenseNote: "Reads only public pages a normal visitor can see; obeys robots.txt and makes a small number of requests per site.",
  refreshNote: "On demand or after discovery.",
  updateMode: "on_demand",
  minIntervalMinutes: 0,
  supportedCountries: "all",
  dataFields: ["technologies", "hosting/CDN hints", "SSL", "HTTP status", "response time", "metadata", "broken links", "public emails/phones", "social profile links"],
  secretFields: [],
  settingFields: [],
  worksWithoutKey: true,
  reliability: 0.8,
  capabilities: { enrichment: true },
  async test(ctx) {
    const res = await ctx.http("https://example.com", { timeoutMs: 10000, retries: 0 });
    return res.ok ? { ok: true, message: "Outbound HTTPS works" } : { ok: false, message: `example.com returned HTTP ${res.status}` };
  },
};

export const pagespeedProvider: ProviderDefinition = {
  id: "pagespeed",
  name: "Google PageSpeed Insights",
  category: "website_technology",
  description: "Lighthouse lab measurements (mobile performance, accessibility, SEO, best practices) for analyzed websites.",
  docsUrl: "https://developers.google.com/speed/docs/insights/v5/get-started",
  pricingNote: "Free. Works without a key at low volume; a free API key raises the quota (25,000 requests/day).",
  licenseNote: "Google APIs Terms of Service.",
  refreshNote: "On demand. Each test takes 10–30 seconds.",
  updateMode: "on_demand",
  minIntervalMinutes: 0,
  supportedCountries: "all",
  dataFields: ["performance score", "accessibility score", "SEO score", "best-practices score", "LCP", "CLS"],
  secretFields: [{ key: "apiKey", label: "API key (optional)", type: "secret", help: "Google Cloud console → APIs → PageSpeed Insights API → Credentials." }],
  settingFields: [],
  worksWithoutKey: true,
  defaultEnabled: false,
  reliability: 0.9,
  capabilities: { enrichment: true },
  async test(ctx) {
    const res = await ctx.http(pagespeedUrl("https://example.com", ctx.secrets.apiKey, ["performance"]), { timeoutMs: 60000, retries: 0 });
    if (!res.ok) return { ok: false, message: res.status === 429 ? "Quota exceeded without key — add a free API key" : `HTTP ${res.status}` };
    return { ok: true, message: "PageSpeed Insights reachable" };
  },
};

export function pagespeedUrl(url: string, key: string | undefined, categories = ["performance", "accessibility", "seo", "best-practices"]) {
  const p = new URLSearchParams({ url, strategy: "mobile" });
  for (const c of categories) p.append("category", c);
  if (key) p.set("key", key);
  return `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${p}`;
}

export const dnsEmailProvider: ProviderDefinition = {
  id: "dns_email",
  name: "Email syntax & MX checks (built-in)",
  category: "email_verification",
  description:
    "Checks email syntax and whether the domain publishes mail (MX) records. This can mark an address 'Domain valid' or 'Invalid' — it cannot prove a mailbox exists, so it never marks an address 'Verified'.",
  docsUrl: "/app/help#email-verification",
  pricingNote: "Free — uses DNS from your server.",
  licenseNote: "DNS lookups only. No SMTP probing of mail servers.",
  refreshNote: "On demand.",
  updateMode: "on_demand",
  minIntervalMinutes: 0,
  supportedCountries: "all",
  dataFields: ["syntax validity", "MX records", "domain status"],
  secretFields: [],
  settingFields: [],
  worksWithoutKey: true,
  reliability: 0.7,
  capabilities: { enrichment: true },
  async test() {
    const { resolveMx } = await import("node:dns/promises");
    const mx = await resolveMx("gmail.com");
    return mx.length ? { ok: true, message: `DNS resolution works (${mx.length} MX records for gmail.com)` } : { ok: false, message: "No MX records returned" };
  },
};

export const hubspotProvider: ProviderDefinition = {
  id: "hubspot",
  name: "HubSpot CRM (free)",
  category: "crm",
  description: "Send qualified leads to HubSpot's free CRM as Company records (name, domain, phone, city, country) with a note linking back to LeadOrbit.",
  docsUrl: "https://developers.hubspot.com/docs/api/private-apps",
  pricingNote: "HubSpot Free CRM supports private-app tokens at no cost.",
  licenseNote: "Data you push becomes part of your HubSpot account.",
  refreshNote: "Pushed when you click 'Send to HubSpot' or when a monitoring rule qualifies a lead.",
  updateMode: "on_demand",
  minIntervalMinutes: 0,
  supportedCountries: "all",
  dataFields: ["company name", "domain", "phone", "city", "country", "industry"],
  secretFields: [{ key: "token", label: "Private app access token", type: "secret", required: true, help: "HubSpot → Settings → Integrations → Private apps. Scope: crm.objects.companies.write + read." }],
  settingFields: [{ key: "autoPush", label: "Automatically send leads qualified by monitoring rules", type: "checkbox" }],
  worksWithoutKey: false,
  reliability: 1,
  capabilities: { crmPush: true },
  async test(ctx) {
    const res = await ctx.http("https://api.hubapi.com/crm/v3/objects/companies?limit=1", { headers: { Authorization: `Bearer ${ctx.secrets.token ?? ""}` }, retries: 0, timeoutMs: 15000 });
    if (res.status === 401) return { ok: false, message: "Token rejected (HTTP 401)" };
    assertOk(res, "HubSpot");
    return { ok: true, message: "HubSpot token accepted" };
  },
};

const SOCIAL_LIMITATION =
  "Public APIs do not let third-party apps search other companies' posts or new pages, and scraping is prohibited by the platform's terms. LeadOrbit does not log in to, scrape or bypass this platform.";

export const linkedinProvider: ProviderDefinition = {
  id: "linkedin",
  name: "LinkedIn",
  category: "social",
  description: "Company page links are collected when a business publishes them on its own website or map listing.",
  docsUrl: "https://learn.microsoft.com/en-us/linkedin/",
  pricingNote: "Partner programs only.",
  licenseNote: "LinkedIn User Agreement prohibits scraping.",
  refreshNote: "Not available.",
  updateMode: "on_demand",
  minIntervalMinutes: 0,
  supportedCountries: "all",
  dataFields: ["public company page URL (from the business's own site)"],
  secretFields: [],
  settingFields: [],
  worksWithoutKey: false,
  unavailableReason: `${SOCIAL_LIMITATION} Alternatives: company page links found by the website analyzer, Hacker News launches, and RSS feeds of press releases.`,
  reliability: 0,
  capabilities: {},
};

export const facebookProvider: ProviderDefinition = {
  ...linkedinProvider,
  id: "facebook",
  name: "Facebook",
  docsUrl: "https://developers.facebook.com/docs/graph-api/",
  pricingNote: "Page Public Content Access requires Meta app review.",
  licenseNote: "Meta Platform Terms prohibit scraping.",
  dataFields: ["public page URL (from the business's own site or map listing)"],
  unavailableReason: `${SOCIAL_LIMITATION} Account creation dates are never inferred. Alternatives: Facebook page links from OpenStreetMap and business websites, plus RSS feeds.`,
};
