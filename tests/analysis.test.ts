import { describe, expect, it } from "vitest";
import { analyzeWebsite, deriveOpportunities } from "@/lib/analysis/analyzer";
import { isPublicIp, robotsAllows, assertPublicHost } from "@/lib/analysis/net";
import { checkEmail } from "@/lib/analysis/email";
import { fakeHttp } from "./helpers/fake-http";
import { dentistContact, dentistHomepage } from "./fixtures/osm";

const publicResolver = async () => ["93.184.216.34"];
const okTls = async () => ({ valid: true, issuer: "Let's Encrypt", validTo: new Date(Date.now() + 60 * 86400_000), error: null });

describe("website analyzer", () => {
  it("detects technologies, measured vs heuristic issues, contacts and evidence-backed opportunities", async () => {
    const http = fakeHttp([
      { match: "/robots.txt", body: "User-agent: *\nDisallow: /private" },
      { match: /^http:\/\/zahnarzt-mueller\.de/, status: 301, body: "", headers: { location: "https://zahnarzt-mueller.de/" } },
      { match: "/kontakt", body: dentistContact },
      { match: "/team", body: "<html></html>" },
      { match: "/old-page", status: 404, body: "not found" },
      { match: "https://zahnarzt-mueller.de", body: dentistHomepage, headers: { server: "Apache", "x-powered-by": "PHP/7.2" } },
    ]);
    const r = await analyzeWebsite("https://zahnarzt-mueller.de", { http: http.client, resolve: publicResolver, tls: okTls });
    expect(r.reachable).toBe(true);
    expect(r.https).toBe(true);
    const names = r.technologies.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["WordPress 5.2.1", "jQuery", "Apache", "PHP"]));
    const codes = Object.fromEntries(r.issues.map((i) => [i.code, i.kind]));
    expect(codes).toMatchObject({ missing_viewport: "measured", missing_h1: "measured", outdated_jquery: "measured", outdated_cms: "measured", broken_links: "measured", legacy_markup: "heuristic", stale_copyright: "heuristic", images_missing_alt: "measured" });
    expect(codes.no_https_redirect).toBeUndefined();
    const emails = r.contacts.filter((c) => c.type === "email").map((c) => c.value);
    expect(emails).toEqual(expect.arrayContaining(["info@zahnarzt-mueller.de", "termine@zahnarzt-mueller.de"]));
    expect(emails).not.toContain("gmail@gmail.com"); // third-party addresses in page text are ignored
    expect(r.contacts.filter((c) => c.type === "facebook")).toHaveLength(1); // share links excluded
    expect(r.contacts.find((c) => c.type === "phone")?.value).toBe("+493099999");
    const redesign = r.opportunities.find((o) => o.title.includes("WordPress redesign"));
    expect(redesign?.confidence).toBe("high");
    expect(redesign?.evidence.length).toBeGreaterThan(1);
  });

  it("respects robots.txt", async () => {
    const http = fakeHttp([{ match: "/robots.txt", body: "User-agent: *\nDisallow: /" }]);
    const r = await analyzeWebsite("https://blocked.example", { http: http.client, resolve: publicResolver, tls: okTls });
    expect(r.error).toMatch(/robots\.txt/);
    expect(http.calls).toHaveLength(1);
  });

  it("refuses private network targets (SSRF)", async () => {
    expect(isPublicIp("10.0.0.5")).toBe(false);
    expect(isPublicIp("169.254.169.254")).toBe(false);
    expect(isPublicIp("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIp("8.8.8.8")).toBe(true);
    await expect(assertPublicHost("metadata.internal", publicResolver)).rejects.toThrow();
    await expect(assertPublicHost("evil.example", async () => ["127.0.0.1"])).rejects.toThrow(/non-public/);
    const http = fakeHttp([]);
    await expect(analyzeWebsite("https://evil.example", { http: http.client, resolve: async () => ["192.168.1.1"], tls: okTls })).rejects.toThrow(/non-public/);
  });

  it("reports unreachable sites as a measured issue", async () => {
    const http = fakeHttp([{ match: "/robots.txt", status: 404, body: "" }, { match: "down.example", status: 503, body: "down" }]);
    const r = await analyzeWebsite("https://down.example", { http: http.client, resolve: publicResolver, tls: okTls });
    expect(r.reachable).toBe(false);
    expect(r.issues[0].code).toBe("http_error");
    expect(r.opportunities[0].title).toMatch(/down or inaccessible/);
  });

  it("derives no opportunities without evidence", () => {
    expect(deriveOpportunities({ reachable: true, issues: [], technologies: [], https: true, httpStatus: 200, error: null })).toEqual([]);
  });

  it("evaluates robots rules with longest match", () => {
    const txt = "User-agent: *\nDisallow: /shop\nAllow: /shop/contact";
    expect(robotsAllows(txt, "/shop/cart")).toBe(false);
    expect(robotsAllows(txt, "/shop/contact")).toBe(true);
    expect(robotsAllows(txt, "/")).toBe(true);
  });
});

describe("email checks never claim mailbox verification", () => {
  const dns = (mx: string[] | Error, a: string[] = []) => ({
    resolveMx: async () => {
      if (mx instanceof Error) throw mx;
      return mx.map((exchange, priority) => ({ exchange, priority }));
    },
    resolveA: async () => a,
  });
  it("domain with MX → domain_valid (not verified)", async () => {
    const r = await checkEmail("info@example.de", dns(["mx1.example.de"]));
    expect(r.status).toBe("domain_valid");
    expect(r.detail).toMatch(/not confirmed/);
  });
  it("bad syntax → invalid", async () => expect((await checkEmail("not-an-email", dns([]))).status).toBe("invalid"));
  it("NXDOMAIN → invalid", async () => expect((await checkEmail("a@nope.example", dns(Object.assign(new Error("x"), { code: "ENOTFOUND" })))).status).toBe("invalid"));
  it("DNS timeout → unknown", async () => expect((await checkEmail("a@slow.example", dns(Object.assign(new Error("x"), { code: "ETIMEOUT" })))).status).toBe("unknown"));
  it("null MX → invalid", async () => expect((await checkEmail("a@nomail.example", dns(["."]))).status).toBe("invalid"));
});
