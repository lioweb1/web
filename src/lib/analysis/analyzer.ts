import * as cheerio from "cheerio";
import type { HttpClient } from "@/lib/providers/http";
import { ProviderHttpError } from "@/lib/providers/http";
import { pagespeedUrl } from "@/lib/providers/others";
import { detectTechnologies, jqueryVersion, primaryPlatform, type Tech } from "./detect";
import { safeFetch, robotsAllows, type Resolver, type TlsChecker } from "./net";
import { normalizeEmail, normalizePhone, registrableDomain } from "@/lib/discovery/normalize";

export type Issue = { code: string; label: string; kind: "measured" | "heuristic"; severity: "low" | "medium" | "high"; evidence: string };
export type Opportunity = { title: string; evidence: string[]; service: string; confidence: "low" | "medium" | "high" };
export type FoundContact = { type: "email" | "phone" | "contact_page" | "linkedin" | "facebook" | "instagram" | "x"; value: string; sourceUrl: string };

export type AnalysisResult = {
  url: string;
  finalUrl: string | null;
  httpStatus: number | null;
  reachable: boolean;
  https: boolean | null;
  responseMs: number | null;
  pageBytes: number | null;
  title: string | null;
  technologies: Tech[];
  issues: Issue[];
  opportunities: Opportunity[];
  contacts: FoundContact[];
  metrics: Record<string, number | string | boolean | null>;
  tls: { valid: boolean; issuer: string | null; validTo: Date | null; error: string | null } | null;
  error: string | null;
};

export type AnalyzerDeps = {
  http: HttpClient;
  resolve: Resolver;
  tls: TlsChecker;
  pagespeed?: { enabled: boolean; apiKey?: string };
  maxLinkChecks?: number;
};

const SOCIAL_PATTERNS: [FoundContact["type"], RegExp][] = [
  ["linkedin", /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/[^/?#]+/i],
  ["facebook", /^https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b)[^/?#]+/i],
  ["instagram", /^https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|share)[^/?#]+/i],
  ["x", /^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home)[^/?#]+/i],
];

const CONTACT_LINK = /\b(contact|kontakt|contacto|contato|contatti|contactez|yhteystiedot|kontakta|impressum|about)\b/i;

export function extractContacts($: cheerio.CheerioAPI, pageUrl: string, siteDomain: string | null): FoundContact[] {
  const out = new Map<string, FoundContact>();
  const add = (c: FoundContact) => out.set(`${c.type}:${c.value}`, c);
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (/^mailto:/i.test(href)) {
      const e = normalizeEmail(href);
      if (e) add({ type: "email", value: e, sourceUrl: pageUrl });
    } else if (/^tel:/i.test(href)) {
      const p = normalizePhone(href);
      if (p) add({ type: "phone", value: p, sourceUrl: pageUrl });
    } else {
      for (const [type, re] of SOCIAL_PATTERNS) {
        const m = href.match(re);
        if (m) add({ type, value: m[0].replace(/\/$/, ""), sourceUrl: pageUrl });
      }
      const text = $(el).text();
      if (CONTACT_LINK.test(href) || CONTACT_LINK.test(text)) {
        try {
          const abs = new URL(href, pageUrl);
          if (registrableDomain(abs.hostname) === siteDomain && /contact|kontakt|contacto|contato|contatti/i.test(abs.pathname + text)) {
            add({ type: "contact_page", value: abs.toString().split("#")[0], sourceUrl: pageUrl });
          }
        } catch {
          /* ignore malformed */
        }
      }
    }
  });
  // Plain-text emails published on the page (only same-domain addresses, to avoid picking up third-party addresses).
  const text = $("body").text();
  for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    const e = normalizeEmail(m[0]);
    if (e && siteDomain && registrableDomain(e.split("@")[1]) === siteDomain) add({ type: "email", value: e, sourceUrl: pageUrl });
  }
  // schema.org JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      for (const node of Array.isArray(data) ? data : data["@graph"] ?? [data]) {
        if (typeof node?.telephone === "string") {
          const p = normalizePhone(node.telephone);
          if (p) add({ type: "phone", value: p, sourceUrl: pageUrl });
        }
        if (typeof node?.email === "string") {
          const e = normalizeEmail(node.email);
          if (e) add({ type: "email", value: e, sourceUrl: pageUrl });
        }
        for (const s of Array.isArray(node?.sameAs) ? node.sameAs : []) {
          for (const [type, re] of SOCIAL_PATTERNS) if (typeof s === "string" && re.test(s)) add({ type, value: s.replace(/\/$/, ""), sourceUrl: pageUrl });
        }
      }
    } catch {
      /* invalid JSON-LD is common; ignore */
    }
  });
  return [...out.values()];
}

function checkHtml($: cheerio.CheerioAPI, html: string, techs: Tech[]): { issues: Issue[]; metrics: AnalysisResult["metrics"] } {
  const issues: Issue[] = [];
  const title = $("title").first().text().trim();
  const desc = $('meta[name="description" i]').attr("content")?.trim();
  const viewport = $('meta[name="viewport" i]').attr("content");
  const h1 = $("h1").length;
  const imgs = $("img");
  const noAlt = imgs.filter((_, el) => $(el).attr("alt") === undefined).length;
  const lang = $("html").attr("lang");
  const og = $('meta[property="og:title"]').length > 0;

  if (!title) issues.push({ code: "missing_title", label: "Missing page title", kind: "measured", severity: "medium", evidence: "No <title> element on the homepage." });
  else if (title.length < 10) issues.push({ code: "short_title", label: "Very short page title", kind: "measured", severity: "low", evidence: `Title is "${title}".` });
  if (!desc) issues.push({ code: "missing_meta_description", label: "Missing meta description", kind: "measured", severity: "low", evidence: "No <meta name=description> on the homepage." });
  if (!viewport) issues.push({ code: "missing_viewport", label: "Not mobile-optimized (no viewport meta tag)", kind: "measured", severity: "high", evidence: "Without a viewport tag phones render the desktop layout zoomed out." });
  if (h1 === 0) issues.push({ code: "missing_h1", label: "No H1 heading", kind: "measured", severity: "low", evidence: "Homepage has no <h1>, weakening content structure and SEO." });
  if (imgs.length >= 3 && noAlt / imgs.length > 0.5)
    issues.push({ code: "images_missing_alt", label: "Images missing alt text", kind: "measured", severity: "medium", evidence: `${noAlt} of ${imgs.length} images have no alt attribute (accessibility).` });
  if (!lang) issues.push({ code: "missing_lang", label: "Missing language attribute", kind: "measured", severity: "low", evidence: "<html> has no lang attribute (screen readers)." });
  if (!og) issues.push({ code: "missing_open_graph", label: "No social sharing metadata", kind: "measured", severity: "low", evidence: "No Open Graph tags; links shared on social media show no preview." });

  const legacy = [$("font").length && "<font> tags", $("center").length && "<center> tags", $("marquee").length && "<marquee>", /\.swf\b/i.test(html) && "Flash (.swf)", $("table[width], td[bgcolor]").length > 3 && "table-based layout"].filter(Boolean);
  if (legacy.length) issues.push({ code: "legacy_markup", label: "Legacy HTML markup", kind: "heuristic", severity: "medium", evidence: `Uses ${legacy.join(", ")} — typical of sites built before ~2012.` });

  const jq = jqueryVersion(techs);
  if (jq && Number(jq.split(".")[0]) < 3) issues.push({ code: "outdated_jquery", label: "Outdated jQuery version", kind: "measured", severity: "medium", evidence: `jQuery ${jq} detected (v1/v2 are end-of-life with known vulnerabilities).` });
  const wp = techs.find((t) => t.name.startsWith("WordPress "))?.name.split(" ")[1];
  if (wp && Number(wp.split(".")[0]) < 6) issues.push({ code: "outdated_cms", label: "Outdated WordPress version", kind: "measured", severity: "high", evidence: `Generator tag reports WordPress ${wp}.` });

  const footer = $("footer").text() || $("body").text().slice(-3000);
  const years = [...footer.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((m) => Number(m[1]));
  const year = years.length ? Math.max(...years) : null;
  const currentYear = new Date().getFullYear();
  if (year && currentYear - year >= 3)
    issues.push({ code: "stale_copyright", label: "Content may not be maintained", kind: "heuristic", severity: "low", evidence: `Footer copyright year is ${year}.` });

  return {
    issues,
    metrics: { titleLength: title.length || 0, hasMetaDescription: !!desc, hasViewport: !!viewport, h1Count: h1, images: imgs.length, imagesWithoutAlt: noAlt, copyrightYear: year },
  };
}

async function checkLinks(deps: AnalyzerDeps, $: cheerio.CheerioAPI, base: string, robots: string | null): Promise<{ checked: number; broken: { url: string; status: number | string }[] }> {
  const baseUrl = new URL(base);
  const urls = new Set<string>();
  $("a[href]").each((_, el) => {
    try {
      const u = new URL($(el).attr("href")!, base);
      if (u.hostname === baseUrl.hostname && /^https?:$/.test(u.protocol) && !/\.(pdf|jpe?g|png|gif|zip|mp4|webp|svg)$/i.test(u.pathname)) {
        u.hash = "";
        if (u.toString() !== baseUrl.toString() && (!robots || robotsAllows(robots, u.pathname))) urls.add(u.toString());
      }
    } catch {
      /* ignore */
    }
  });
  const sample = [...urls].slice(0, deps.maxLinkChecks ?? 12);
  const broken: { url: string; status: number | string }[] = [];
  for (const u of sample) {
    try {
      const r = await safeFetch(deps.http, deps.resolve, u, { method: "GET", timeoutMs: 10000, minIntervalMs: 300, maxBytes: 200_000 });
      if (r.status >= 400) broken.push({ url: u, status: r.status });
    } catch (e) {
      broken.push({ url: u, status: e instanceof Error ? e.message.slice(0, 80) : "error" });
    }
  }
  return { checked: sample.length, broken };
}

async function runPagespeed(deps: AnalyzerDeps, url: string) {
  const res = await deps.http(pagespeedUrl(url, deps.pagespeed?.apiKey), { timeoutMs: 90_000, retries: 1 });
  if (!res.ok) return { error: `PageSpeed HTTP ${res.status}` };
  const data = JSON.parse(res.text) as {
    lighthouseResult?: { categories?: Record<string, { score: number | null }>; audits?: Record<string, { numericValue?: number }> };
  };
  const c = data.lighthouseResult?.categories ?? {};
  const a = data.lighthouseResult?.audits ?? {};
  const pct = (k: string) => (c[k]?.score == null ? null : Math.round(c[k].score! * 100));
  return {
    performance: pct("performance"),
    accessibility: pct("accessibility"),
    seo: pct("seo"),
    bestPractices: pct("best-practices"),
    lcpMs: a["largest-contentful-paint"]?.numericValue ? Math.round(a["largest-contentful-paint"].numericValue) : null,
    cls: a["cumulative-layout-shift"]?.numericValue ?? null,
  };
}

/** Derive opportunities strictly from recorded issues; nothing is inferred about intent. */
export function deriveOpportunities(r: Pick<AnalysisResult, "reachable" | "issues" | "technologies" | "https" | "httpStatus" | "error">): Opportunity[] {
  const ops: Opportunity[] = [];
  const has = (code: string) => r.issues.find((i) => i.code === code);
  const platform = primaryPlatform(r.technologies);
  if (!r.reachable) {
    ops.push({ title: "Website appears down or inaccessible", evidence: [r.error ?? `HTTP ${r.httpStatus}`], service: "Website recovery, hosting migration or rebuild", confidence: "medium" });
    return ops;
  }
  const mobile = [has("missing_viewport"), has("poor_mobile_performance")].filter(Boolean) as Issue[];
  const dated = [has("legacy_markup"), has("outdated_jquery"), has("outdated_cms"), has("stale_copyright")].filter(Boolean) as Issue[];
  if (mobile.length || dated.length >= 2) {
    const evidence = [...mobile, ...dated].map((i) => i.evidence);
    ops.push({
      title: platform ? `Potential ${platform} redesign` : "Potential responsive redesign",
      evidence,
      service: platform === "WordPress" ? "WordPress modernization & responsive redesign" : "Responsive website redesign",
      confidence: mobile.length && dated.length ? "high" : "medium",
    });
  }
  const broken = has("broken_links");
  const slow = has("slow_response") ?? has("poor_mobile_performance");
  if (broken || slow) ops.push({ title: "Website optimization", evidence: [broken?.evidence, slow?.evidence].filter(Boolean) as string[], service: "Performance optimization & site maintenance", confidence: broken && slow ? "medium" : "low" });
  const sslIssues = [has("no_https"), has("no_https_redirect"), has("ssl_invalid"), has("ssl_expiring")].filter(Boolean) as Issue[];
  if (sslIssues.length) ops.push({ title: "Security / SSL setup", evidence: sslIssues.map((i) => i.evidence), service: "SSL configuration, hosting & security hardening", confidence: "high" });
  const seo = [has("missing_title"), has("missing_meta_description"), has("missing_h1"), has("missing_open_graph")].filter(Boolean) as Issue[];
  if (seo.length >= 2) ops.push({ title: "On-page SEO improvements", evidence: seo.map((i) => i.evidence), service: "Technical SEO setup", confidence: "medium" });
  const a11y = [has("images_missing_alt"), has("missing_lang"), has("poor_accessibility")].filter(Boolean) as Issue[];
  if (a11y.length) ops.push({ title: "Accessibility improvements", evidence: a11y.map((i) => i.evidence), service: "Accessibility (WCAG) remediation", confidence: a11y.length >= 2 ? "medium" : "low" });
  if (["Wix", "Squarespace", "GoDaddy Website Builder", "Weebly", "Jimdo"].includes(platform ?? ""))
    ops.push({ title: `Possible migration from ${platform}`, evidence: [`Site is built on ${platform}.`], service: "Migration to WordPress/Webflow with custom design", confidence: "low" });
  return ops;
}

export async function analyzeWebsite(inputUrl: string, deps: AnalyzerDeps): Promise<AnalysisResult> {
  const base: AnalysisResult = {
    url: inputUrl, finalUrl: null, httpStatus: null, reachable: false, https: null, responseMs: null, pageBytes: null, title: null,
    technologies: [], issues: [], opportunities: [], contacts: [], metrics: {}, tls: null, error: null,
  };
  const host = new URL(inputUrl).hostname;
  const siteDomain = registrableDomain(host);

  // robots.txt — if the homepage is disallowed for us, stop.
  let robots: string | null = null;
  try {
    const r = await safeFetch(deps.http, deps.resolve, `https://${host}/robots.txt`, { timeoutMs: 8000, maxBytes: 100_000 });
    if (r.ok) robots = r.text;
  } catch {
    /* robots.txt unavailable: proceed as allowed */
  }
  if (robots && !robotsAllows(robots, new URL(inputUrl).pathname || "/")) {
    return { ...base, error: "robots.txt disallows automated access to this page; analysis skipped." };
  }

  let res;
  try {
    res = await safeFetch(deps.http, deps.resolve, inputUrl.replace(/^http:/, "https:"), { timeoutMs: 20000 });
  } catch (e) {
    try {
      res = await safeFetch(deps.http, deps.resolve, inputUrl.replace(/^https:/, "http:"), { timeoutMs: 20000 });
    } catch {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof ProviderHttpError && /non-public|Refusing/.test(msg)) throw e;
      base.issues.push({ code: "unreachable", label: "Website unreachable", kind: "measured", severity: "high", evidence: msg });
      return { ...base, error: msg, opportunities: deriveOpportunities({ ...base, error: msg }) };
    }
  }
  const finalUrl = res.url;
  const isHttps = finalUrl.startsWith("https:");
  const out: AnalysisResult = { ...base, finalUrl, httpStatus: res.status, https: isHttps, responseMs: res.elapsedMs, pageBytes: Buffer.byteLength(res.text) };

  if (res.status >= 400) {
    out.issues.push({ code: "http_error", label: `Homepage returns HTTP ${res.status}`, kind: "measured", severity: "high", evidence: `GET ${finalUrl} → ${res.status}` });
    out.error = `HTTP ${res.status}`;
    out.opportunities = deriveOpportunities(out);
    return out;
  }
  out.reachable = true;
  const $ = cheerio.load(res.text);
  out.title = $("title").first().text().trim().slice(0, 300) || null;
  out.technologies = detectTechnologies(res.text, res.headers, $);
  const html = checkHtml($, res.text, out.technologies);
  out.issues.push(...html.issues);
  Object.assign(out.metrics, html.metrics);

  if (!isHttps) {
    out.issues.push({ code: "no_https", label: "No HTTPS", kind: "measured", severity: "high", evidence: `Site is served over plain HTTP (${finalUrl}). Browsers mark it "Not secure".` });
  } else {
    out.tls = await deps.tls(new URL(finalUrl).hostname);
    if (!out.tls.valid) out.issues.push({ code: "ssl_invalid", label: "Invalid SSL certificate", kind: "measured", severity: "high", evidence: out.tls.error ?? "Certificate not trusted" });
    else if (out.tls.validTo && out.tls.validTo.getTime() - Date.now() < 14 * 86400_000)
      out.issues.push({ code: "ssl_expiring", label: "SSL certificate expiring soon", kind: "measured", severity: "medium", evidence: `Expires ${out.tls.validTo.toISOString().slice(0, 10)}.` });
    // does plain http redirect to https?
    try {
      const plain = await safeFetch(deps.http, deps.resolve, finalUrl.replace(/^https:/, "http:"), { timeoutMs: 8000, maxBytes: 50_000 });
      if (!plain.url.startsWith("https:")) out.issues.push({ code: "no_https_redirect", label: "HTTP does not redirect to HTTPS", kind: "measured", severity: "medium", evidence: "Visitors typing the address without https stay on an insecure connection." });
    } catch {
      /* port 80 closed is fine */
    }
  }
  if (res.elapsedMs > 3000)
    out.issues.push({ code: "slow_response", label: "Slow server response", kind: "measured", severity: "medium", evidence: `Homepage took ${(res.elapsedMs / 1000).toFixed(1)}s to download from our server (location-dependent).` });

  const links = await checkLinks(deps, $, finalUrl, robots);
  out.metrics.linksChecked = links.checked;
  out.metrics.brokenLinks = links.broken.length;
  if (links.broken.length)
    out.issues.push({
      code: "broken_links",
      label: `${links.broken.length} broken internal link${links.broken.length > 1 ? "s" : ""}`,
      kind: "measured",
      severity: links.broken.length >= 3 ? "high" : "medium",
      evidence: `${links.broken.length} of ${links.checked} sampled links failed: ${links.broken.slice(0, 3).map((b) => `${new URL(b.url).pathname} (${b.status})`).join(", ")}`,
    });

  out.contacts = extractContacts($, finalUrl, siteDomain);
  const contactPage = out.contacts.find((c) => c.type === "contact_page");
  if (contactPage && (!robots || robotsAllows(robots, new URL(contactPage.value).pathname))) {
    try {
      const cp = await safeFetch(deps.http, deps.resolve, contactPage.value, { timeoutMs: 12000, minIntervalMs: 300 });
      if (cp.ok) {
        const seen = new Set(out.contacts.map((c) => `${c.type}:${c.value}`));
        for (const c of extractContacts(cheerio.load(cp.text), cp.url, siteDomain)) if (!seen.has(`${c.type}:${c.value}`) && c.type !== "contact_page") out.contacts.push(c);
      }
    } catch {
      /* contact page fetch is best-effort */
    }
  }

  if (deps.pagespeed?.enabled) {
    try {
      const ps = await runPagespeed(deps, finalUrl);
      Object.assign(out.metrics, Object.fromEntries(Object.entries(ps).map(([k, v]) => [`lighthouse_${k}`, v as number | string | null])));
      if ("performance" in ps && ps.performance != null && ps.performance < 50)
        out.issues.push({ code: "poor_mobile_performance", label: "Poor mobile performance", kind: "measured", severity: "high", evidence: `Lighthouse mobile performance score ${ps.performance}/100${ps.lcpMs ? `, LCP ${(ps.lcpMs / 1000).toFixed(1)}s` : ""}.` });
      if ("accessibility" in ps && ps.accessibility != null && ps.accessibility < 70)
        out.issues.push({ code: "poor_accessibility", label: "Accessibility problems", kind: "measured", severity: "medium", evidence: `Lighthouse accessibility score ${ps.accessibility}/100.` });
    } catch (e) {
      out.metrics.lighthouse_error = e instanceof Error ? e.message : String(e);
    }
  }
  out.opportunities = deriveOpportunities(out);
  return out;
}
