import { assertOk, parseJson, type HttpClient } from "./http";
import type { ProviderDefinition } from "./types";

type Bootstrap = { services: [string[], string[]][] };
type RdapEvent = { eventAction: string; eventDate: string };
type RdapEntity = { roles?: string[]; vcardArray?: [string, [string, object, string, string][]] };
type RdapDomain = { ldhName?: string; status?: string[]; events?: RdapEvent[]; entities?: RdapEntity[] };

let bootstrapCache: { at: number; map: Map<string, string> } | null = null;

async function rdapBaseFor(http: HttpClient, tld: string): Promise<string | null> {
  if (!bootstrapCache || Date.now() - bootstrapCache.at > 24 * 3600_000) {
    const res = await http("https://data.iana.org/rdap/dns.json", { timeoutMs: 20000 });
    assertOk(res, "IANA RDAP bootstrap");
    const data = parseJson<Bootstrap>(res, "IANA RDAP bootstrap");
    const map = new Map<string, string>();
    for (const [tlds, urls] of data.services) for (const t of tlds) map.set(t.toLowerCase(), urls.find((u) => u.startsWith("https")) ?? urls[0]);
    bootstrapCache = { at: Date.now(), map };
  }
  return bootstrapCache.map.get(tld.toLowerCase()) ?? null;
}

export type RdapResult = { found: boolean; registeredAt: Date | null; registrar: string | null; status: string[]; source: string; expiresAt: Date | null };

export function parseRdap(data: RdapDomain, source: string): RdapResult {
  const ev = (a: string) => data.events?.find((e) => e.eventAction === a)?.eventDate;
  const registrarEntity = data.entities?.find((e) => e.roles?.includes("registrar"));
  const fn = registrarEntity?.vcardArray?.[1]?.find((f) => f[0] === "fn")?.[3] ?? null;
  return {
    found: true,
    registeredAt: ev("registration") ? new Date(ev("registration")!) : null,
    expiresAt: ev("expiration") ? new Date(ev("expiration")!) : null,
    registrar: fn,
    status: data.status ?? [],
    source,
  };
}

/** Look up registration data for a domain over RDAP (IANA bootstrap, falling back to rdap.org). */
export async function rdapLookup(http: HttpClient, domain: string): Promise<RdapResult> {
  const tld = domain.split(".").pop()!;
  const base = (await rdapBaseFor(http, tld)) ?? "https://rdap.org/";
  const url = `${base.replace(/\/?$/, "/")}domain/${encodeURIComponent(domain)}`;
  const res = await http(url, { headers: { Accept: "application/rdap+json" }, timeoutMs: 20000, minIntervalMs: 500 });
  if (res.status === 404) return { found: false, registeredAt: null, registrar: null, status: [], source: url, expiresAt: null };
  assertOk(res, "RDAP");
  return parseRdap(parseJson<RdapDomain>(res, "RDAP"), url);
}

export const rdapProvider: ProviderDefinition = {
  id: "rdap",
  name: "RDAP (domain registration data)",
  category: "rdap",
  description: "Registration date, registrar and status for domains, from each registry's official RDAP service (IANA bootstrap).",
  docsUrl: "https://www.iana.org/domains/rdap",
  pricingNote: "Free. Registries apply their own rate limits; requests are spaced out automatically.",
  licenseNote: "Registry terms of use apply. Personal registrant data is redacted by registries and is never collected.",
  refreshNote: "On demand, per domain.",
  updateMode: "on_demand",
  minIntervalMinutes: 0,
  supportedCountries: "all",
  dataFields: ["registration date", "expiration date", "registrar", "status"],
  secretFields: [],
  settingFields: [],
  worksWithoutKey: true,
  reliability: 0.95,
  capabilities: { enrichment: true },
  async test(ctx) {
    const r = await rdapLookup(ctx.http, "example.com");
    return r.found ? { ok: true, message: `RDAP reachable (example.com registered ${r.registeredAt?.toISOString().slice(0, 10) ?? "n/a"})` } : { ok: false, message: "RDAP lookup returned not found for example.com" };
  },
};
