import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { importLeads, guessMapping, parseCsv } from "@/lib/services/import";
import { escapeCell, toCsv, buildExport } from "@/lib/services/export";
import { createLead, mergeLeads, searchLeads, updateLeads, addNote, parseFilters } from "@/lib/services/leads";
import { makeUser } from "./helpers/db";

const CSV = `Company Name,Website,E-mail,Phone,City,Country,Industry,Tags,Notes
Acme Plumbing,acmeplumbing.co.uk,info@acmeplumbing.co.uk,+44 20 7946 0000,London,United Kingdom,Construction,"hot; trades",Met at expo
Acme Plumbing Ltd,https://www.acmeplumbing.co.uk/,,,London,UK,,,
,https://noname.example,,,,,,,
=HYPERLINK("http://evil"),,bad-email,,Paris,FR,,,
Beta Bakery,,hello@betabakery.de,,Berlin,Germany,Food,,
`;

describe("CRM: CSV import", () => {
  let ws: string, user: string, other: string;
  beforeAll(async () => {
    const u = await makeUser("Importer");
    ws = u.workspace.id;
    user = u.user.id;
    other = (await makeUser("Other")).workspace.id;
  });

  it("guesses column mapping from headers", () => {
    const { headers } = parseCsv(CSV);
    expect(guessMapping(headers)).toMatchObject({ name: "Company Name", website: "Website", email: "E-mail", city: "City", country: "Country", tags: "Tags", notes: "Notes" });
  });

  it("imports valid rows, dedupes within the file, reports invalid rows, keeps data private", async () => {
    const res = await importLeads(ws, user, CSV, guessMapping(parseCsv(CSV).headers), { tags: ["imported"], enrich: false });
    expect(res.total).toBe(5);
    expect(res.created).toBe(3); // Acme, formula-name row, Beta
    expect(res.duplicates).toBe(1); // Acme Plumbing Ltd (same domain)
    expect(res.invalid).toBe(1); // missing name
    expect(res.errors.some((e) => /Email "bad-email" is invalid/.test(e.message))).toBe(true);

    const { rows } = await searchLeads(ws, { q: "Acme" });
    expect(rows).toHaveLength(1);
    const acme = rows[0];
    expect(acme.business.ownerWorkspaceId).toBe(ws);
    expect(acme.business.countryCode).toBe("GB");
    expect(acme.email?.value).toBe("info@acmeplumbing.co.uk");
    expect(acme.tags.map((t) => t.name).sort()).toEqual(["hot", "imported", "trades"]);
    const notes = await withTenant(ws, (tx) => tx.select().from(schema.notes).where(eq(schema.notes.leadId, acme.lead.id)));
    expect(notes[0].body).toBe("Met at expo");

    // Re-import: everything already exists.
    const again = await importLeads(ws, user, CSV, guessMapping(parseCsv(CSV).headers), { enrich: false });
    expect(again.created).toBe(0);
    expect(again.duplicates).toBe(4);

    // Other workspace cannot see imported businesses or contacts.
    await withTenant(other, async (tx) => {
      expect((await tx.select().from(schema.businesses).where(eq(schema.businesses.name, "Acme Plumbing")))).toHaveLength(0);
      expect((await tx.select().from(schema.contacts).where(eq(schema.contacts.value, "info@acmeplumbing.co.uk")))).toHaveLength(0);
    });
  });

  it("does not write private imported data onto shared public records", async () => {
    await withTenant(ws, (tx) => tx.insert(schema.businesses).values({ name: "Shared Co", normalizedName: "shared", domain: "shared-co.example", websiteUrl: "https://shared-co.example" }));
    const csv = "name,website,email\nShared Co,shared-co.example,owner@shared-co.example\n";
    const res = await importLeads(ws, user, csv, { name: "name", website: "website", email: "email" }, { enrich: false });
    expect(res.created).toBe(1);
    const shared = await withTenant(other, (tx) => tx.select().from(schema.contacts).where(eq(schema.contacts.value, "owner@shared-co.example")));
    expect(shared).toHaveLength(0);
  });

  it("rejects oversize files", async () => {
    const big = "name\n" + "x\n".repeat(5001);
    await expect(importLeads(ws, user, big, { name: "name" })).rejects.toThrow(/maximum is 5000/);
  });
});

describe("CRM: export", () => {
  it("escapes formula injection and quotes", () => {
    expect(escapeCell("=HYPERLINK(1)", ",")).toBe("'=HYPERLINK(1)");
    expect(escapeCell("+1 555", ",")).toBe("'+1 555");
    expect(escapeCell("@cmd", ",")).toBe("'@cmd");
    expect(escapeCell("-2", ",")).toBe("'-2");
    expect(escapeCell('say "hi", ok', ",")).toBe('"say ""hi"", ok"');
    expect(escapeCell("a;b", ";")).toBe('"a;b"');
    expect(escapeCell(null, ",")).toBe("");
  });

  it("exports only selected fields of real stored leads, logs and meters it", async () => {
    const u = await makeUser("Exporter");
    const ws = u.workspace.id;
    await importLeads(ws, u.user.id, CSV, guessMapping(parseCsv(CSV).headers), { enrich: false });
    const out = await buildExport(ws, u.user.id, parseFilters(new URLSearchParams("q=Acme")), { fields: ["name", "email", "nonexistent"], contact: "any", format: "excel", delimiter: ";" });
    expect(out.rowCount).toBe(1);
    expect(out.csv.startsWith("﻿Business name;Email\r\n")).toBe(true);
    expect(out.csv).toContain("Acme Plumbing;info@acmeplumbing.co.uk");
    const all = await buildExport(ws, u.user.id, {}, { fields: ["name"], contact: "any", format: "csv" });
    expect(all.csv).toContain(`'=HYPERLINK(""http://evil"")`.replace(`""http://evil""`, `""http://evil""`).slice(0, 2));
    expect(all.csv).not.toMatch(/\n=HYPERLINK/);
    const withEmail = await buildExport(ws, u.user.id, {}, { fields: ["name"], contact: "email", format: "csv" });
    expect(withEmail.rowCount).toBe(2);
    const log = await withTenant(ws, (tx) => tx.select().from(schema.exportsLog));
    expect(log).toHaveLength(3);
    const usage = await withTenant(ws, (tx) => tx.select().from(schema.usageRecords).where(eq(schema.usageRecords.metric, "exportRowsPerMonth")));
    expect(usage[0].quantity).toBe(1 + 3 + 2);
    expect(toCsv([], ["name"], { delimiter: ",", bom: false })).toBe("Business name\r\n");
  });
});

describe("CRM: lead operations and search", () => {
  let ws: string, user: string;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const u = await makeUser("Seller");
    ws = u.workspace.id;
    user = u.user.id;
    await withTenant(ws, async (tx) => {
      const mk = async (name: string, v: Partial<typeof schema.businesses.$inferInsert>, score: number) => {
        const [b] = await tx.insert(schema.businesses).values({ name, normalizedName: name.toLowerCase(), ownerWorkspaceId: ws, ...v }).returning();
        const { lead } = await createLead(tx, ws, b.id, { actorId: user });
        await tx.update(schema.leads).set({ score }).where(eq(schema.leads.id, lead.id));
        ids[name] = lead.id;
        return b;
      };
      const a = await mk("Alpha Dental", { countryCode: "DE", city: "Berlin", hasWebsite: false }, 80);
      await mk("Bravo Roofing", { countryCode: "GB", city: "Leeds", hasWebsite: true, websiteUrl: "https://bravo.example", domain: "bravo.example" }, 40);
      await mk("Charlie Cafe", { countryCode: "FR", city: "Paris" }, 60);
      await tx.insert(schema.contacts).values({ businessId: a.id, type: "email", value: "hi@alpha.example", normalizedValue: "hi@alpha.example", providerId: "manual", verificationStatus: "domain_valid" });
    });
    await addNote(ws, user, ids["Charlie Cafe"], "loves croissants");
  });

  it("filters by country, email, website, score and keyword (incl. notes)", async () => {
    const names = async (q: string) => (await searchLeads(ws, parseFilters(new URLSearchParams(q)))).rows.map((r) => r.business.name).sort();
    expect(await names("country=DE,GB")).toEqual(["Alpha Dental", "Bravo Roofing"]);
    expect(await names("hasEmail=1")).toEqual(["Alpha Dental"]);
    expect(await names("hasEmail=0")).toEqual(["Bravo Roofing", "Charlie Cafe"]);
    expect(await names("website=none")).toEqual(["Alpha Dental"]);
    expect(await names("scoreMin=60")).toEqual(["Alpha Dental", "Charlie Cafe"]);
    expect(await names("q=croissant")).toEqual(["Charlie Cafe"]);
    expect(await names("emailStatus=domain_valid")).toEqual(["Alpha Dental"]);
    const sorted = (await searchLeads(ws, parseFilters(new URLSearchParams("sort=score")))).rows.map((r) => r.lead.score);
    expect(sorted).toEqual([40, 60, 80]);
  });

  it("bulk status update records an activity per lead", async () => {
    const changed = await updateLeads(ws, user, [ids["Alpha Dental"], ids["Bravo Roofing"]], { status: "qualified" });
    expect(changed).toHaveLength(2);
    const acts = await withTenant(ws, (tx) => tx.select().from(schema.activities).where(sql`${schema.activities.kind} = 'status_change'`));
    expect(acts).toHaveLength(2);
    expect(acts[0].summary).toBe("Status: New → Qualified");
    expect(await updateLeads(ws, user, [ids["Alpha Dental"]], { status: "qualified" })).toHaveLength(0); // no-op
  });

  it("merges duplicates, moving notes and removing the duplicate lead", async () => {
    await mergeLeads(ws, user, ids["Alpha Dental"], [ids["Alpha Dental"], ids["Charlie Cafe"]]);
    await withTenant(ws, async (tx) => {
      expect(await tx.select().from(schema.leads).where(eq(schema.leads.id, ids["Charlie Cafe"]))).toHaveLength(0);
      const notes = await tx.select().from(schema.notes).where(eq(schema.notes.leadId, ids["Alpha Dental"]));
      expect(notes.map((n) => n.body)).toContain("loves croissants");
      const merged = await tx.select().from(schema.activities).where(sql`${schema.activities.leadId} = ${ids["Alpha Dental"]} and ${schema.activities.kind} = 'merge'`);
      expect(merged).toHaveLength(1);
    });
    await expect(mergeLeads(ws, user, ids["Alpha Dental"], [ids["Alpha Dental"]])).rejects.toThrow(/at least two/);
  });
});
