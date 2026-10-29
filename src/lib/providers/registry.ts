import type { ProviderDefinition } from "./types";
import { osmProvider } from "./osm";
import { companiesHouseProvider } from "./companies-house";
import { crtshProvider } from "./crtsh";
import { hackerNewsProvider } from "./hackernews";
import { rssProvider } from "./rss";
import { rdapProvider } from "./rdap";
import { websiteAnalyzerProvider, pagespeedProvider, dnsEmailProvider, hubspotProvider, linkedinProvider, facebookProvider } from "./others";

export const PROVIDERS: ProviderDefinition[] = [
  osmProvider,
  companiesHouseProvider,
  crtshProvider,
  hackerNewsProvider,
  rssProvider,
  rdapProvider,
  websiteAnalyzerProvider,
  pagespeedProvider,
  dnsEmailProvider,
  hubspotProvider,
  linkedinProvider,
  facebookProvider,
];

/** Non-provider sources that can appear in provenance. */
export const OTHER_SOURCES: Record<string, { name: string; reliability: number }> = {
  csv_import: { name: "CSV import", reliability: 0.5 },
  manual: { name: "Added manually", reliability: 0.6 },
};

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function sourceName(id: string | null | undefined): string {
  if (!id) return "Unknown";
  return getProvider(id)?.name ?? OTHER_SOURCES[id]?.name ?? id;
}

export function sourceReliability(id: string): number {
  return getProvider(id)?.reliability ?? OTHER_SOURCES[id]?.reliability ?? 0.3;
}

export const DISCOVERY_PROVIDERS = PROVIDERS.filter((p) => p.capabilities.discovery && !p.unavailableReason);
