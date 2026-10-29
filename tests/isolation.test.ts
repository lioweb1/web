import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@/lib/db";
import { createLead, addNote, searchLeads } from "@/lib/services/leads";
import { makeUser } from "./helpers/db";

const pgError = (re: RegExp) => (e: unknown) => re.test(String((e as { cause?: Error }).cause?.message ?? (e as Error).message));

describe("workspace isolation (PostgreSQL RLS)", () => {
  let a: string, b: string, userA: string;
  let leadA: string;
  beforeAll(async () => {
    const ua = await makeUser("Alice");
    const ub = await makeUser("Bob");
    a = ua.workspace.id;
    b = ub.workspace.id;
    userA = ua.user.id;
    leadA = await withTenant(a, async (tx) => {
      const [biz] = await tx.insert(schema.businesses).values({ name: "Private Import Co", normalizedName: "private import", ownerWorkspaceId: a }).returning();
      const { lead } = await createLead(tx, a, biz.id, { actorId: userA });
      return lead.id;
    });
    await addNote(a, userA, leadA, "secret pricing note");
  });

  it("other workspaces cannot read leads, notes or private businesses", async () => {
    await withTenant(b, async (tx) => {
      expect(await tx.select().from(schema.leads)).toHaveLength(0);
      expect(await tx.select().from(schema.notes)).toHaveLength(0);
      expect((await tx.select().from(schema.businesses)).filter((x) => x.name === "Private Import Co")).toHaveLength(0);
      expect(await tx.select().from(schema.targetMarkets).where(eq(schema.targetMarkets.workspaceId, a))).toHaveLength(0);
    });
    expect((await searchLeads(b, { q: "Private" })).total).toBe(0);
    expect((await searchLeads(a, { q: "secret pricing" })).total).toBe(1);
  });

  it("filters by workspace even if the app passes another workspace id in a query", async () => {
    await withTenant(b, async (tx) => {
      expect(await tx.select().from(schema.leads).where(eq(schema.leads.workspaceId, a))).toHaveLength(0);
    });
  });

  it("rejects writes into another workspace", async () => {
    await expect(withTenant(b, (tx) => tx.insert(schema.notes).values({ workspaceId: a, leadId: leadA, body: "injected" }))).rejects.toSatisfy(pgError(/row-level security/));
    const res = await withTenant(b, (tx) => tx.update(schema.leads).set({ status: "won" }).where(eq(schema.leads.id, leadA)).returning());
    expect(res).toHaveLength(0);
  });

  it("tenant role cannot read password hashes, sessions or other users", async () => {
    await expect(withTenant(b, (tx) => tx.execute(sql`select password_hash from users`))).rejects.toSatisfy(pgError(/permission denied/));
    await expect(withTenant(b, (tx) => tx.execute(sql`select * from sessions`))).rejects.toSatisfy(pgError(/permission denied/));
    const users = await withTenant(b, (tx) => tx.execute(sql`select id, email from users`));
    expect(users.rows).toHaveLength(1);
  });

  it("without a workspace context nothing is visible", async () => {
    // set_config with an empty id is rejected by withTenant; emulate a missing context:
    await expect(withTenant("not-a-uuid", async () => 1)).rejects.toThrow(/Invalid workspace/);
  });
});
