import { countries as COUNTRY_DATA, continents } from "countries-list";

export type Country = { code: string; name: string; native: string; region: string; continent: string };

/** Commonly used Middle East grouping (overlaps the Asian continent; used as a selectable group). */
const MIDDLE_EAST = ["AE", "BH", "CY", "EG", "IL", "IQ", "IR", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "TR", "YE"];

function regionFor(code: string, continent: string): string {
  if (MIDDLE_EAST.includes(code)) return "Middle East";
  if (continent === "NA") return ["US", "CA", "MX", "GL", "BM", "PM"].includes(code) ? "North America" : "Central America & Caribbean";
  if (continent === "SA") return "South America";
  return (continents as Record<string, string>)[continent] ?? "Other";
}

export const COUNTRIES: Country[] = Object.entries(COUNTRY_DATA)
  .map(([code, c]) => ({ code, name: c.name, native: c.native, continent: c.continent, region: regionFor(code, c.continent) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export const REGIONS = Array.from(new Set(COUNTRIES.map((c) => c.region))).sort();

/**
 * Default targeting preset. These are markets users commonly sell into; inclusion
 * here says nothing about purchasing intent — scoring uses actual business signals.
 */
export const PREMIUM_MARKETS = [
  "US", "GB", "CA", "AU", "NZ", "DE", "FR", "NL", "CH", "SE", "NO", "DK", "FI", "IE", "BE", "AT", "LU", "SG",
] as const;

export const COUNTRY_GROUPS: { id: string; name: string; codes: string[] }[] = [
  { id: "premium", name: "Premium Markets", codes: [...PREMIUM_MARKETS] },
  { id: "north-america", name: "North America", codes: ["US", "CA"] },
  { id: "dach", name: "DACH", codes: ["DE", "AT", "CH"] },
  { id: "nordics", name: "Nordics", codes: ["SE", "NO", "DK", "FI", "IS"] },
  { id: "benelux", name: "Benelux", codes: ["BE", "NL", "LU"] },
  { id: "anz", name: "Australia & New Zealand", codes: ["AU", "NZ"] },
  { id: "uk-ie", name: "UK & Ireland", codes: ["GB", "IE"] },
  { id: "gcc", name: "Gulf (GCC)", codes: ["AE", "SA", "QA", "KW", "BH", "OM"] },
  ...REGIONS.map((r) => ({ id: `region:${r}`, name: r, codes: COUNTRIES.filter((c) => c.region === r).map((c) => c.code) })),
];

export function countryName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return BY_CODE.get(code.toUpperCase())?.name ?? code.toUpperCase();
}

export function isCountryCode(code: string): boolean {
  return BY_CODE.has(code.toUpperCase());
}

export function countryRegion(code: string | null | undefined): string | null {
  return code ? (BY_CODE.get(code.toUpperCase())?.region ?? null) : null;
}

export function flag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "🏳️";
  return String.fromCodePoint(...code.toUpperCase().split("").map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** Resolve a free-form country string (name, native name or ISO code) to an ISO code. */
export function resolveCountry(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim();
  if (v.length === 2 && BY_CODE.has(v.toUpperCase())) return v.toUpperCase();
  const lower = v.toLowerCase();
  const aliases: Record<string, string> = { uk: "GB", "united kingdom": "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB", usa: "US", "united states of america": "US", uae: "AE" };
  if (aliases[lower]) return aliases[lower];
  return COUNTRIES.find((c) => c.name.toLowerCase() === lower || c.native.toLowerCase() === lower)?.code ?? null;
}
