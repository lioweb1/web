import { assertOk, parseJson, ProviderHttpError } from "./http";
import type { DiscoveredRecord, ProviderContext, ProviderDefinition } from "./types";
import type { RuleCriteria } from "@/lib/db/schema";
import { normalizeEmail, normalizePhone, normalizeUrl, registrableDomain, isPlatformDomain } from "@/lib/discovery/normalize";
import { countryRegion } from "@/lib/countries";

/** Business categories mapped to OpenStreetMap tag filters. */
export const OSM_CATEGORIES: { id: string; label: string; industry: string; filters: string[] }[] = [
  { id: "restaurants", label: "Restaurants & cafés", industry: "Food & Beverage", filters: ['["amenity"~"^(restaurant|cafe|bar|pub|fast_food|ice_cream|biergarten)$"]'] },
  { id: "retail", label: "Retail shops", industry: "Retail", filters: ['["shop"]["shop"!~"^(vacant|no)$"]'] },
  { id: "beauty", label: "Beauty, hair & spa", industry: "Beauty & Wellness", filters: ['["shop"~"^(hairdresser|beauty|cosmetics|massage|tattoo|nail_salon)$"]', '["leisure"="spa"]'] },
  { id: "health", label: "Health, dental & clinics", industry: "Healthcare", filters: ['["amenity"~"^(dentist|clinic|doctors|veterinary|pharmacy)$"]', '["healthcare"]'] },
  { id: "legal", label: "Legal services", industry: "Legal", filters: ['["office"~"^(lawyer|notary)$"]'] },
  { id: "finance", label: "Accounting & finance", industry: "Finance", filters: ['["office"~"^(accountant|financial|financial_advisor|tax_advisor|insurance)$"]'] },
  { id: "real_estate", label: "Real estate", industry: "Real Estate", filters: ['["office"~"^(estate_agent|property_management)$"]'] },
  { id: "trades", label: "Construction & trades", industry: "Construction & Trades", filters: ['["craft"~"^(builder|carpenter|electrician|plumber|painter|roofer|hvac|tiler|gardener|locksmith|glazier)$"]', '["office"="construction_company"]'] },
  { id: "automotive", label: "Automotive", industry: "Automotive", filters: ['["shop"~"^(car|car_repair|car_parts|tyres|motorcycle)$"]', '["amenity"="car_wash"]'] },
  { id: "lodging", label: "Hotels & lodging", industry: "Hospitality", filters: ['["tourism"~"^(hotel|guest_house|hostel|motel|apartment|chalet)$"]'] },
  { id: "fitness", label: "Fitness & sports", industry: "Fitness", filters: ['["leisure"~"^(fitness_centre|sports_centre)$"]', '["sport"]["leisure"]'] },
  { id: "education", label: "Education & training", industry: "Education", filters: ['["amenity"~"^(language_school|driving_school|music_school|training)$"]', '["office"="educational_institution"]'] },
  { id: "professional", label: "Agencies & offices", industry: "Professional Services", filters: ['["office"~"^(company|it|consulting|advertising_agency|architect|employment_agency|marketing)$"]'] },
  { id: "crafts_makers", label: "Crafts & makers", industry: "Crafts & Manufacturing", filters: ['["craft"~"^(bakery|brewery|winery|confectionery|jeweller|tailor|shoemaker|photographer|printer)$"]'] },
];

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  timestamp?: string;
  tags?: Record<string, string>;
};

type NominatimPlace = { osm_type: string; osm_id: number; display_name: string; address?: Record<string, string>; class?: string; type?: string };

function overpassUrl(ctx: ProviderContext) {
  return (ctx.settings.overpassUrl as string) || process.env.OVERPASS_API_URL || "https://overpass-api.de/api/interpreter";
}
function nominatimUrl(ctx: ProviderContext) {
  return (ctx.settings.nominatimUrl as string) || process.env.NOMINATIM_API_URL || "https://nominatim.openstreetmap.org";
}

/** Resolve a city within a country to an Overpass area id via Nominatim (1 req/s policy). */
export async function resolveArea(ctx: ProviderContext, city: string, countryCode: string): Promise<{ areaId: number; label: string }> {
  const url = `${nominatimUrl(ctx)}/search?${new URLSearchParams({ q: city, countrycodes: countryCode.toLowerCase(), format: "jsonv2", limit: "5", addressdetails: "1" })}`;
  const res = await ctx.http(url, { minIntervalMs: 1100, timeoutMs: 15000 });
  assertOk(res, "Nominatim");
  const places = parseJson<NominatimPlace[]>(res, "Nominatim");
  const rel = places.find((p) => p.osm_type === "relation" && (p.class === "boundary" || p.class === "place")) ?? places.find((p) => p.osm_type === "relation");
  if (!rel) throw new ProviderHttpError(`Could not find an administrative area for "${city}" in ${countryCode}. Try the official city name.`, 404, false);
  return { areaId: 3_600_000_000 + rel.osm_id, label: rel.display_name };
}

export function buildOverpassQuery(opts: { areaId: number; criteria: RuleCriteria; since?: Date | null; limit: number }) {
  const cats = opts.criteria.categories?.length ? OSM_CATEGORIES.filter((c) => opts.criteria.categories!.includes(c.id)) : OSM_CATEGORIES;
  const site = opts.criteria.websiteState === "no_website" ? '[!"website"][!"contact:website"][!"url"]' : opts.criteria.websiteState === "has_website" ? '["website"]' : "";
  const kw = opts.criteria.keyword?.trim() ? `["name"~"${opts.criteria.keyword.trim().replace(/["\\]/g, "").replace(/[.*+?^${}()|[\]]/g, "\\$&")}",i]` : "";
  const newer = opts.since ? `(newer:"${opts.since.toISOString().slice(0, 19)}Z")` : "";
  const lines = cats.flatMap((c) => c.filters.map((f) => `  nwr${f}["name"]${site}${kw}(area.a)${newer};`));
  return `[out:json][timeout:90];\narea(id:${opts.areaId})->.a;\n(\n${lines.join("\n")}\n);\nout center meta ${opts.limit};`;
}

function categoryFor(tags: Record<string, string>) {
  for (const c of OSM_CATEGORIES) {
    for (const f of c.filters) {
      const m = f.match(/^\["([^"]+)"(?:(~|=)"([^"]+)")?\]/);
      if (!m) continue;
      const [, key, op, val] = m;
      const v = tags[key];
      if (v === undefined) continue;
      if (!op || (op === "=" && v === val) || (op === "~" && new RegExp(val).test(v))) {
        return { industry: c.industry, category: `${key}=${v}`, categoryId: c.id };
      }
    }
  }
  const key = ["shop", "amenity", "office", "craft", "tourism", "leisure", "healthcare"].find((k) => tags[k]);
  return { industry: null, category: key ? `${key}=${tags[key]}` : null, categoryId: null };
}

export function mapElement(el: OverpassElement, countryCode: string, fallbackCity: string | null): DiscoveredRecord | null {
  const t = el.tags ?? {};
  if (!t.name) return null;
  const rawSite = t.website ?? t["contact:website"] ?? t.url ?? null;
  let websiteUrl = normalizeUrl(rawSite);
  const siteDomain = registrableDomain(websiteUrl);
  // A Facebook page in the website tag is not an owned website.
  const socials: DiscoveredRecord["socials"] = [];
  if (websiteUrl && isPlatformDomain(siteDomain)) {
    if (siteDomain === "facebook.com") socials.push({ type: "facebook", url: websiteUrl });
    websiteUrl = null;
  }
  const fb = t["contact:facebook"] ?? t.facebook;
  if (fb) socials.push({ type: "facebook", url: fb.startsWith("http") ? fb : `https://www.facebook.com/${fb}` });
  const li = t["contact:linkedin"] ?? t.linkedin;
  if (li && /linkedin\.com\/company\//i.test(li)) socials.push({ type: "linkedin", url: li });
  const ig = t["contact:instagram"] ?? t.instagram;
  if (ig) socials.push({ type: "instagram", url: ig.startsWith("http") ? ig : `https://www.instagram.com/${ig.replace(/^@/, "")}` });

  const { industry, category } = categoryFor(t);
  const lat = el.lat ?? el.center?.lat ?? null;
  const lon = el.lon ?? el.center?.lon ?? null;
  const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
  const signals: DiscoveredRecord["signals"] = [];
  const opened = t.opening_date ?? t.start_date;
  if (opened && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(opened)) {
    signals.push({ type: "business_launch", title: `OpenStreetMap lists an opening/start date of ${opened}`, externalId: `osm:${el.type}/${el.id}:start:${opened}`, publishedAt: new Date(opened.length === 4 ? `${opened}-01-01` : opened) });
  }
  if (!websiteUrl) {
    signals.push({ type: "no_website", title: "No website listed on OpenStreetMap", summary: "The map listing has no website tag. This may mean the business has no site, or that the listing is incomplete.", externalId: `osm:${el.type}/${el.id}:nowebsite` });
  }
  return {
    externalKey: `osm:${el.type}/${el.id}`,
    name: t.name,
    category,
    industry,
    businessType: "Local business",
    countryCode,
    countryEvidence: "OpenStreetMap area search",
    region: t["addr:state"] ?? t["addr:province"] ?? countryRegion(countryCode),
    city: t["addr:city"] ?? fallbackCity,
    address: street || null,
    postcode: t["addr:postcode"] ?? null,
    lat,
    lon,
    websiteUrl,
    noWebsiteListed: !websiteUrl,
    phone: normalizePhone(t.phone ?? t["contact:phone"] ?? t["contact:mobile"]),
    email: normalizeEmail(t.email ?? t["contact:email"]),
    socials,
    sourcePublishedAt: el.timestamp ? new Date(el.timestamp) : null,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    signals,
  };
}

export const osmProvider: ProviderDefinition = {
  id: "osm",
  name: "OpenStreetMap (Overpass + Nominatim)",
  category: "business_directory",
  description:
    "Local businesses mapped by the OpenStreetMap community: names, categories, addresses, phone, email and website tags. Ideal for finding local businesses without a website.",
  docsUrl: "https://wiki.openstreetmap.org/wiki/Overpass_API",
  pricingNote: "Free. Public instances have fair-use limits; you can point to your own Overpass/Nominatim server in settings.",
  licenseNote: "Data © OpenStreetMap contributors, ODbL 1.0. Attribution is shown wherever OSM data is displayed.",
  refreshNote: "Periodic. Supports 'changed since' queries, which reflect map edits — not business opening dates.",
  updateMode: "periodic",
  minIntervalMinutes: 60,
  supportedCountries: "all",
  dataFields: ["name", "category", "address", "city", "postcode", "coordinates", "website", "phone", "email", "social links", "opening date (when mapped)"],
  secretFields: [],
  settingFields: [
    { key: "overpassUrl", label: "Overpass API URL", type: "text", help: "Defaults to the public overpass-api.de instance." },
    { key: "nominatimUrl", label: "Nominatim URL", type: "text", help: "Defaults to nominatim.openstreetmap.org (max 1 request/second)." },
  ],
  worksWithoutKey: true,
  reliability: 0.6,
  capabilities: { discovery: true },
  criteriaSupport: ["countries", "cities", "categories", "keyword", "websiteState"],
  async test(ctx) {
    const res = await ctx.http(overpassUrl(ctx).replace(/interpreter$/, "status"), { timeoutMs: 15000, retries: 0 });
    if (!res.ok) return { ok: false, message: `Overpass status endpoint returned HTTP ${res.status}` };
    const slots = res.text.match(/(\d+) slots available now/);
    return { ok: true, message: slots ? `Overpass reachable, ${slots[1]} query slots available now` : "Overpass reachable" };
  },
  async discover(ctx, criteria) {
    const countries = criteria.countries ?? [];
    const cities = criteria.cities ?? [];
    if (countries.length !== 1 || cities.length === 0) {
      throw new ProviderHttpError("OpenStreetMap discovery needs exactly one country and at least one city (country-wide queries are too heavy for public servers).", 400, false);
    }
    const country = countries[0];
    const limit = Math.min(Number(ctx.settings.maxResults ?? 200), 500);
    const records: DiscoveredRecord[] = [];
    const notes: string[] = [];
    let requests = 0;
    for (const city of cities.slice(0, 5)) {
      const area = await resolveArea(ctx, city, country);
      requests++;
      const query = buildOverpassQuery({ areaId: area.areaId, criteria, since: ctx.since, limit });
      const res = await ctx.http(overpassUrl(ctx), {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeoutMs: 120_000,
        minIntervalMs: 2000,
        maxBytes: 20_000_000,
      });
      requests++;
      assertOk(res, "Overpass API");
      const data = parseJson<{ elements: OverpassElement[]; remark?: string }>(res, "Overpass API");
      if (data.remark) notes.push(`Overpass: ${data.remark}`);
      for (const el of data.elements) {
        const rec = mapElement(el, country, city);
        if (rec) records.push(rec);
      }
      if (data.elements.length >= limit) notes.push(`Result limit (${limit}) reached for ${city}; narrow the categories or keyword to see more.`);
    }
    if (ctx.since) notes.push(`Only map entries edited since ${ctx.since.toISOString().slice(0, 10)} were requested. An edit date is not a business opening date.`);
    return { records, notes, requests };
  },
};
