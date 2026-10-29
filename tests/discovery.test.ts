import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { runDiscovery } from "@/lib/discovery/pipeline";
import { setHttpClientForTests } from "@/lib/services/integrations";
import { buildOverpassQuery, mapElement } from "@/lib/providers/osm";
import { fakeHttp } from "./helpers/fake-http";
import { makeUser } from "./helpers/db";
import { nominatimBerlin, overpassBerlin } from "./fixtures/osm";

const routes = [
  { match: "nominatim", body: nominatimBerlin },
  { match: "overpass", body: overpassBerlin },
];

describe("OpenStreetMap discovery", () => {
  let ws: string;
  beforeAll(async () => {
    ws = (await makeUser()).workspace.id;
  });
  afterEach(() => setHttpClientForTests(null));

  it("builds a bounded Overpass query with the no-website filter", () => {
    const q = buildOverpassQuery({ areaId: 3600062422, criteria: { categories: ["health"], websiteState: "no_website", keyword: 'zahn"' }, limit: 100 });
    expect(q).toContain("area(id:3600062422)");
    expect(q).toContain('[!"website"]');
    expect(q).toContain('["name"~"zahn",i]');
    expect(q).toContain("out center meta 100");
  });

  it("does not treat a Facebook page as an owned website", () => {
    const rec = mapElement(overpassBerlin.elements[2] as never, "DE", "Berlin")!;
    expect(rec.websiteUrl).toBeNull();
    expect(rec.socials?.[0]).toMatchObject({ type: "facebook" });
    expect(rec.noWebsiteListed).toBe(true);
  });

  it("stores real records with source, provenance, contacts and dedupes on re-run", async () => {
    const http = fakeHttp(routes);
    setHttpClientForTests(http.client);
    const first = await runDiscovery(ws, "osm", { countries: ["DE"], cities: ["Berlin"] });
    expect(first.fetched).toBe(3); // unnamed element skipped
    expect(first.newBusinesses).toBe(3);
    expect(http.calls[0].url).toContain("countrycodes=de");

    const again = await runDiscovery(ws, "osm", { countries: ["DE"], cities: ["Berlin"] });
    expect(again.newBusinesses).toBe(0);
    expect(again.updatedBusinesses).toBe(3);

    await withTenant(ws, async (tx) => {
      const [b] = await tx.select().from(schema.businesses).where(eq(schema.businesses.domain, "zahnarzt-mueller.de"));
      expect(b.name).toBe("Zahnarztpraxis Müller");
      expect(b.industry).toBe("Healthcare");
      expect(b.hasWebsite).toBe(true);
      expect(b.registrationDate).toBeNull(); // OSM never claims a launch date
      const obs = await tx.select().from(schema.sourceObservations).where(eq(schema.sourceObservations.businessId, b.id));
      expect(obs.every((o) => o.providerId === "osm" && o.sourceUrl === "https://www.openstreetmap.org/way/2002")).toBe(true);
      const contacts = await tx.select().from(schema.contacts).where(eq(schema.contacts.businessId, b.id));
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({ type: "email", verificationStatus: "unverified" });
      const all = await tx.select().from(schema.businesses);
      expect(all.filter((x) => x.name === "Bäckerei Schmidt")).toHaveLength(1);
      const bakery = all.find((x) => x.name === "Bäckerei Schmidt")!;
      expect(bakery.hasWebsite).toBe(false);
      const sig = await tx.select().from(schema.businessSignals).where(eq(schema.businessSignals.businessId, bakery.id));
      expect(sig.map((s) => s.type)).toEqual(["no_website"]);
    });
  });

  it("requires one country and a city", async () => {
    setHttpClientForTests(fakeHttp(routes).client);
    await expect(runDiscovery(ws, "osm", { countries: ["DE", "FR"], cities: ["Berlin"] })).rejects.toThrow(/exactly one country/);
  });

  it("surfaces provider errors and records them on the integration", async () => {
    setHttpClientForTests(fakeHttp([{ match: "nominatim", body: nominatimBerlin }, { match: "overpass", status: 504, body: "Gateway timeout" }]).client);
    await expect(runDiscovery(ws, "osm", { countries: ["DE"], cities: ["Berlin"] })).rejects.toThrow(/HTTP 504/);
    const [row] = await withTenant(ws, (tx) => tx.select().from(schema.integrations).where(eq(schema.integrations.providerId, "osm")));
    expect(row.lastError).toMatch(/504/);
    expect(row.connectionStatus).toBe("untested"); // a run never marks an integration "connected"
  });
});
