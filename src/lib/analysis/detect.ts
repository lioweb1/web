import type { CheerioAPI } from "cheerio";

export type Tech = { name: string; category: string; evidence: string };

type Sig = { name: string; category: string; html?: RegExp; header?: [string, RegExp]; generator?: RegExp; script?: RegExp };

const SIGNATURES: Sig[] = [
  { name: "WordPress", category: "CMS", generator: /wordpress/i, html: /\/wp-(?:content|includes)\//i },
  { name: "WooCommerce", category: "eCommerce", html: /woocommerce/i },
  { name: "Webflow", category: "CMS", generator: /webflow/i, html: /data-wf-(?:site|page)=/i },
  { name: "Shopify", category: "eCommerce", html: /cdn\.shopify\.com|Shopify\.theme/i, header: ["x-shopid", /./] },
  { name: "Wix", category: "CMS", generator: /wix\.com/i, html: /static\.wixstatic\.com|wix-bolt|_wixCIDX/i },
  { name: "Squarespace", category: "CMS", generator: /squarespace/i, html: /static1\.squarespace\.com|squarespace-cdn/i },
  { name: "Joomla", category: "CMS", generator: /joomla/i, html: /\/media\/jui\/|\/components\/com_/i },
  { name: "Drupal", category: "CMS", generator: /drupal/i, header: ["x-generator", /drupal/i], html: /Drupal\.settings|\/sites\/default\/files\//i },
  { name: "Ghost", category: "CMS", generator: /ghost/i },
  { name: "HubSpot CMS", category: "CMS", html: /\.hs-sites\.com|hs-scripts\.com|hubspot/i },
  { name: "Duda", category: "CMS", html: /dudaone|irp\.cdn-website\.com/i },
  { name: "GoDaddy Website Builder", category: "CMS", generator: /go ?daddy|starfield/i, html: /img1\.wsimg\.com/i },
  { name: "Weebly", category: "CMS", html: /weebly\.com|editmysite\.com/i },
  { name: "Jimdo", category: "CMS", html: /jimdo(?:cdn)?\.com/i },
  { name: "Framer", category: "CMS", html: /framerusercontent\.com|framer\.website/i },
  { name: "Magento", category: "eCommerce", html: /Magento_|mage\/cookies|\/static\/version\d+\/frontend\//i },
  { name: "BigCommerce", category: "eCommerce", html: /cdn\d*\.bigcommerce\.com/i },
  { name: "PrestaShop", category: "eCommerce", generator: /prestashop/i, html: /prestashop/i },
  { name: "OpenCart", category: "eCommerce", html: /catalog\/view\/theme\//i },
  { name: "Next.js", category: "Framework", html: /__NEXT_DATA__|\/_next\/static\//i },
  { name: "Gatsby", category: "Framework", html: /___gatsby/i },
  { name: "Nuxt", category: "Framework", html: /__NUXT__|\/_nuxt\//i },
  { name: "Elementor", category: "Page builder", html: /elementor/i },
  { name: "Divi", category: "Page builder", html: /et_pb_|Divi/ },
  { name: "Bootstrap", category: "UI library", html: /bootstrap(?:\.min)?\.(?:css|js)/i },
  { name: "jQuery", category: "JS library", script: /jquery[.-]?(\d+\.\d+(?:\.\d+)?)?(?:\.min)?\.js/i },
  { name: "Google Tag Manager", category: "Analytics", html: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/ },
  { name: "Google Analytics", category: "Analytics", html: /google-analytics\.com\/(?:analytics|ga)\.js|gtag\/js\?id=(?:G|UA)-/i },
  { name: "Meta Pixel", category: "Analytics", html: /connect\.facebook\.net\/[^/]+\/fbevents\.js/i },
  { name: "Cloudflare", category: "CDN", header: ["cf-ray", /./] },
  { name: "Fastly", category: "CDN", header: ["x-served-by", /cache-/i] },
  { name: "Amazon CloudFront", category: "CDN", header: ["via", /cloudfront/i] },
  { name: "Vercel", category: "Hosting", header: ["x-vercel-id", /./] },
  { name: "Netlify", category: "Hosting", header: ["server", /netlify/i] },
  { name: "GitHub Pages", category: "Hosting", header: ["server", /github\.com/i] },
  { name: "WP Engine", category: "Hosting", header: ["x-powered-by", /wp engine/i] },
  { name: "Kinsta", category: "Hosting", header: ["x-kinsta-cache", /./] },
  { name: "Pantheon", category: "Hosting", header: ["x-pantheon-styx-hostname", /./] },
  { name: "nginx", category: "Web server", header: ["server", /nginx/i] },
  { name: "Apache", category: "Web server", header: ["server", /apache/i] },
  { name: "Microsoft IIS", category: "Web server", header: ["server", /iis/i] },
  { name: "LiteSpeed", category: "Web server", header: ["server", /litespeed/i] },
  { name: "PHP", category: "Language", header: ["x-powered-by", /php/i] },
  { name: "ASP.NET", category: "Language", header: ["x-powered-by", /asp\.net/i] },
];

export function detectTechnologies(html: string, headers: Headers, $: CheerioAPI): Tech[] {
  const found = new Map<string, Tech>();
  const generator = $('meta[name="generator" i]').attr("content") ?? "";
  const scripts = $("script[src]").map((_, el) => $(el).attr("src") ?? "").get().join(" ");
  for (const s of SIGNATURES) {
    let evidence: string | null = null;
    if (s.generator && s.generator.test(generator)) evidence = `meta generator "${generator.slice(0, 60)}"`;
    else if (s.header && s.header[1].test(headers.get(s.header[0]) ?? "")) evidence = `HTTP header ${s.header[0]}: ${(headers.get(s.header[0]) ?? "").slice(0, 60)}`;
    else if (s.script) {
      const m = scripts.match(s.script);
      if (m) evidence = `script ${m[0]}`;
    } else if (s.html) {
      const m = html.match(s.html);
      if (m) evidence = `page source contains "${m[0].slice(0, 50)}"`;
    }
    if (evidence) found.set(s.name, { name: s.name, category: s.category, evidence });
  }
  // generator version for WordPress, e.g. "WordPress 5.2.1"
  const wpVer = generator.match(/WordPress\s+([\d.]+)/i)?.[1];
  if (wpVer && found.has("WordPress")) found.get("WordPress")!.name = `WordPress ${wpVer}`;
  return [...found.values()];
}

export function jqueryVersion(techs: Tech[]): string | null {
  const t = techs.find((x) => x.name === "jQuery");
  return t?.evidence.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null;
}

export function primaryPlatform(techs: { name: string; category: string }[]): string | null {
  return techs.find((t) => t.category === "CMS" || t.category === "eCommerce")?.name.replace(/\s[\d.]+$/, "") ?? null;
}
