import { describe, expect, it } from "vitest";
import { mapCompany, industryFromSic, companiesHouseProvider } from "@/lib/providers/companies-house";
import { mapCrtEntries } from "@/lib/providers/crtsh";
import { mapHits, nameFromLaunchTitle } from "@/lib/providers/hackernews";
import { parseFeed, rssProvider } from "@/lib/providers/rss";
import { parseRdap, rdapLookup } from "@/lib/providers/rdap";
import { classifySignal } from "@/lib/discovery/classify";
import { normalizeName, normalizeUrl, registrableDomain, normalizePhone, countryFromCcTld, isValidEmailSyntax } from "@/lib/discovery/normalize";
import { fakeHttp } from "./helpers/fake-http";
import { chSearch } from "./fixtures/companies-house";

describe("normalization", () => {
  it("normalizes names for duplicate detection", () => {
    expect(normalizeName("Müller & Söhne GmbH")).toBe("muller and sohne");
    expect(normalizeName("ACME Ltd.")).toBe(normalizeName("Acme Limited"));
  });
  it("normalizes URLs and registrable domains", () => {
    expect(normalizeUrl("www.Example.co.uk/?utm_source=x")).toBe("https://www.example.co.uk");
    expect(registrableDomain("https://shop.example.co.uk/path")).toBe("example.co.uk");
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
  it("phones, emails, ccTLD evidence", () => {
    expect(normalizePhone("+44 (0)20 7946 0018")).toBe("+4402079460018");
    expect(normalizePhone("123")).toBeNull();
    expect(isValidEmailSyntax("info@example.com")).toBe(true);
    expect(isValidEmailSyntax("info@example")).toBe(false);
    expect(countryFromCcTld("shop.de")).toBe("DE");
    expect(countryFromCcTld("startup.io")).toBeNull();
    expect(countryFromCcTld("example.co.uk")).toBe("GB");
  });
});

describe("Companies House", () => {
  it("maps incorporations with verified registration dates", () => {
    const r = mapCompany(chSearch.items[0]);
    expect(r).toMatchObject({ countryCode: "GB", city: "Leeds", registrationDate: "2026-10-20", industry: "Construction & Trades", externalKey: "companies_house:15999001" });
    expect(r.signals?.[0].type).toBe("new_registration");
    expect(industryFromSic(["86230"])).toBe("Healthcare");
  });
  it("sends the API key as basic auth and skips non-UK searches", async () => {
    const http = fakeHttp([{ match: "advanced-search", body: chSearch }]);
    const out = await companiesHouseProvider.discover!({ http: http.client, secrets: { apiKey: "k" }, settings: {} }, { keyword: "roof" });
    expect(out.records).toHaveLength(2);
    expect(http.calls[0].url).toContain("company_name_includes=roof");
    const none = await companiesHouseProvider.discover!({ http: http.client, secrets: { apiKey: "k" }, settings: {} }, { countries: ["US"] });
    expect(none.records).toHaveLength(0);
    await expect(companiesHouseProvider.discover!({ http: http.client, secrets: {}, settings: {} }, {})).rejects.toThrow(/API key/);
  });
});

describe("Certificate Transparency", () => {
  it("extracts new registrable domains matching the keyword, ignoring hosting subdomains", () => {
    const since = new Date("2026-10-01").getTime();
    const recs = mapCrtEntries(
      [
        { id: 1, name_value: "www.bestbakery.com\nbestbakery.com", entry_timestamp: "2026-10-25T10:00:00", issuer_name: "C=US, O=Let's Encrypt, CN=R11" },
        { id: 2, name_value: "bakery-shop.myshopify.com", entry_timestamp: "2026-10-25T10:00:00" },
        { id: 3, name_value: "oldbakery.com", entry_timestamp: "2025-01-01T00:00:00" },
        { id: 4, name_value: "berlinbakery.de", entry_timestamp: "2026-10-26T00:00:00" },
      ],
      "bakery",
      since,
    );
    expect(recs.map((r) => r.name).sort()).toEqual(["berlinbakery.de", "bestbakery.com"]);
    const de = recs.find((r) => r.name === "berlinbakery.de")!;
    expect(de.countryCode).toBe("DE");
    expect(de.countryEvidence).toMatch(/weak/);
    expect(de.registrationDate).toBeUndefined(); // a certificate is not a registration date
  });
});

describe("Hacker News", () => {
  it("attributes launches with a website and keeps others unattributed", () => {
    const { records, unattributed } = mapHits([
      { objectID: "1", title: "Show HN: Plantly – watering reminders for your plants", url: "https://plantly.app/?ref=hn", created_at: "2026-10-27T10:00:00Z", created_at_i: 1 },
      { objectID: "2", title: "Ask HN: Looking for a web developer for our bakery website", url: null, created_at: "2026-10-27T11:00:00Z", created_at_i: 2 },
    ]);
    expect(records[0]).toMatchObject({ name: "Plantly", websiteUrl: "https://plantly.app/?ref=hn" });
    expect(records[0].signals?.[0].type).toBe("business_launch");
    expect(unattributed[0].type).toBe("website_requirement");
    expect(nameFromLaunchTitle("Show HN: X", "x.dev")).toBe("X");
  });
});

describe("signal classification is explainable", () => {
  it("records the matching phrases", () => {
    expect(classifySignal("We need a new website for our dental clinic")).toMatchObject({ type: "website_requirement" });
    expect(classifySignal("Time to redesign our website").type).toBe("redesign_requirement");
    expect(classifySignal("Grand opening this Saturday!").type).toBe("business_launch");
    expect(classifySignal("Lovely weather today")).toEqual({ type: "general_update", matched: [] });
  });
});

describe("RSS / Atom", () => {
  it("parses both formats and keeps only classified items", async () => {
    const rss = `<?xml version="1.0"?><rss><channel>
      <item><title>Local bakery announces grand opening</title><link>https://news.example/a</link><pubDate>${new Date().toUTCString()}</pubDate><description>&lt;p&gt;New shop&lt;/p&gt;</description></item>
      <item><title>Council meeting minutes</title><link>https://news.example/b</link><pubDate>${new Date().toUTCString()}</pubDate></item>
    </channel></rss>`;
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom item</title><link href="https://x.example/1"/><updated>2026-10-01T00:00:00Z</updated><id>tag:1</id></entry></feed>`;
    expect(parseFeed(atom)[0]).toMatchObject({ title: "Atom item", link: "https://x.example/1", guid: "tag:1" });
    const http = fakeHttp([{ match: "feed.example", body: rss }]);
    const out = await rssProvider.discover!({ http: http.client, secrets: {}, settings: { feeds: "https://feed.example/rss" } }, {});
    expect(out.unattributedSignals).toHaveLength(1);
    expect(out.unattributedSignals![0]).toMatchObject({ type: "business_launch", url: "https://news.example/a" });
  });
});

describe("RDAP", () => {
  it("uses the IANA bootstrap and parses registration events", async () => {
    const http = fakeHttp([
      { match: "data.iana.org", body: { services: [[["com"], ["https://rdap.verisign.com/com/v1/"]]] } },
      { match: "rdap.verisign.com/com/v1/domain/example.com", body: { ldhName: "EXAMPLE.COM", status: ["client delete prohibited"], events: [{ eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" }, { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" }], entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "RESERVED-Internet Assigned Numbers Authority"]]] }] } },
    ]);
    const r = await rdapLookup(http.client, "example.com");
    expect(r.registeredAt?.toISOString()).toBe("1995-08-14T04:00:00.000Z");
    expect(r.registrar).toBe("RESERVED-Internet Assigned Numbers Authority");
    expect(parseRdap({}, "x").registeredAt).toBeNull();
  });
});
