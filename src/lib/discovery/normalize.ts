import { parse as parseDomain } from "tldts";
import { resolveCountry } from "@/lib/countries";

const LEGAL_SUFFIXES =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|plc|gmbh|ag|sa|sas|sarl|srl|bv|b\.v|nv|oy|ab|as|aps|pty|pte|co|corp|corporation|company|kg|ug|llp|lp)\b\.?/g;

/** Lowercased, accent-free, legal-suffix-free name used for duplicate detection. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9Ѐ-ӿ֐-ۿ一-鿿]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Normalize a website value into an absolute http(s) URL, or null if it is not a usable website. */
export function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim().split(/[\s;,]+/)[0];
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v.replace(/^\/+/, "")}`;
  try {
    const u = new URL(v);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    const info = parseDomain(u.hostname);
    if (!info.domain || !info.isIcann) return null;
    u.hash = "";
    // keep path (some businesses live on a sub-page) but drop tracking params
    for (const p of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(p)) u.searchParams.delete(p);
    let s = u.toString();
    if (u.pathname === "/" && !u.search) s = s.replace(/\/$/, "");
    return s;
  } catch {
    return null;
  }
}

/** Registrable domain (eTLD+1), e.g. "shop.example.co.uk" -> "example.co.uk". */
export function registrableDomain(urlOrHost: string | null | undefined): string | null {
  if (!urlOrHost) return null;
  let host = urlOrHost.trim().toLowerCase();
  try {
    if (/^https?:\/\//.test(host)) host = new URL(host).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^\*\./, "").replace(/\.$/, "");
  const info = parseDomain(host);
  return info.domain && info.isIcann ? info.domain : null;
}

export function tldOf(domain: string): string {
  return parseDomain(domain).publicSuffix ?? domain.split(".").slice(-1)[0];
}

/** Hosts that are platforms, not a business's own website. */
const PLATFORM_DOMAINS = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "youtube.com", "tiktok.com",
  "google.com", "goo.gl", "yelp.com", "tripadvisor.com", "booking.com", "wa.me", "whatsapp.com", "linktr.ee",
  "github.com", "medium.com", "substack.com", "t.me", "pinterest.com", "apple.com", "play.google.com",
]);

export function isPlatformDomain(domain: string | null): boolean {
  return !!domain && PLATFORM_DOMAINS.has(domain);
}

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function isValidEmailSyntax(email: string): boolean {
  if (email.length > 254) return false;
  const [local] = email.split("@");
  if (!local || local.length > 64) return false;
  if (!EMAIL_RE.test(email)) return false;
  const tld = email.split(".").pop() ?? "";
  return /^[a-z]{2,}$/i.test(tld) || /^xn--/i.test(tld);
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().replace(/^mailto:/i, "").split("?")[0].toLowerCase();
  try {
    const decoded = decodeURIComponent(v);
    return isValidEmailSyntax(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Light phone normalization: keep digits and a leading +. Does not validate that the number exists. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/[;,]/)[0].replace(/^tel:/i, "").trim();
  const plus = first.startsWith("+") || first.startsWith("00");
  const digits = first.replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 6 || digits.length > 15) return null;
  return plus ? `+${digits}` : digits;
}

export function normalizeCountry(raw: string | null | undefined): string | null {
  return resolveCountry(raw ?? null);
}

/** Country implied by a ccTLD. This is weak evidence and is recorded as such. */
export function countryFromCcTld(domain: string): string | null {
  const tld = domain.split(".").pop()?.toUpperCase();
  if (!tld || tld.length !== 2) return null;
  if (["IO", "AI", "CO", "ME", "TV", "LY", "FM", "GG", "SH", "AC", "TO", "WS", "CC", "AG", "SO"].includes(tld)) return null;
  if (tld === "UK") return "GB";
  return resolveCountry(tld);
}

export function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
