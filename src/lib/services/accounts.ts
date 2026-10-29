import { and, eq, sql } from "drizzle-orm";
import { schema, systemDb, withTenant } from "@/lib/db";
import { PREMIUM_MARKETS } from "@/lib/countries";
import { hashPassword, verifyPassword } from "@/lib/security/crypto";
import { assertCountBelow } from "@/lib/plans";

export class AuthError extends Error {}

/** Create a user with their own workspace, owner membership and the Premium Markets default target. */
export async function provisionUser(input: { email: string; name: string; passwordHash: string; workspaceName?: string }) {
  return systemDb().transaction(async (tx) => {
    const [existing] = await tx.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = lower(${input.email})`);
    if (existing) throw new AuthError("An account with this email already exists.");
    const [user] = await tx.insert(schema.users).values({ email: input.email.trim(), name: input.name.trim(), passwordHash: input.passwordHash }).returning();
    const [workspace] = await tx
      .insert(schema.workspaces)
      .values({ name: input.workspaceName?.trim() || `${input.name.trim().split(" ")[0]}'s workspace`, settings: { preferredTechnologies: ["WordPress", "Webflow"], targetIndustries: [] } })
      .returning();
    await tx.insert(schema.memberships).values({ workspaceId: workspace.id, userId: user.id, role: "owner" });
    const [market] = await tx.insert(schema.targetMarkets).values({ workspaceId: workspace.id, name: "Premium Markets", mode: "premium", countries: [...PREMIUM_MARKETS] }).returning();
    await tx.update(schema.workspaces).set({ defaultTargetMarketId: market.id }).where(eq(schema.workspaces.id, workspace.id));
    await tx.update(schema.users).set({ defaultWorkspaceId: workspace.id }).where(eq(schema.users.id, user.id));
    return { user, workspace };
  });
}

export async function registerUser(input: { email: string; name: string; password: string; workspaceName?: string }) {
  return provisionUser({ ...input, passwordHash: await hashPassword(input.password) });
}

// Dummy hash so failed lookups take as long as real verifications (no user enumeration by timing).
let dummyHash: Promise<string> | null = null;

export async function authenticate(email: string, password: string) {
  const [user] = await systemDb().select().from(schema.users).where(sql`lower(${schema.users.email}) = lower(${email.trim()})`);
  if (!user || user.deletedAt) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(password, await dummyHash);
    throw new AuthError("Invalid email or password.");
  }
  if (!(await verifyPassword(password, user.passwordHash))) throw new AuthError("Invalid email or password.");
  return user;
}

export async function changePassword(userId: string, current: string, next: string) {
  const [user] = await systemDb().select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || !(await verifyPassword(current, user.passwordHash))) throw new AuthError("Current password is incorrect.");
  await systemDb().update(schema.users).set({ passwordHash: await hashPassword(next), updatedAt: new Date() }).where(eq(schema.users.id, userId));
  // Invalidate all other sessions.
  await systemDb().delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

/** Add an existing user (by email) to a workspace. */
export async function addMember(workspaceId: string, email: string, role: "admin" | "member" | "viewer") {
  const [user] = await systemDb().select().from(schema.users).where(sql`lower(${schema.users.email}) = lower(${email.trim()})`);
  if (!user || user.deletedAt) throw new Error("No LeadOrbit account uses that email. Ask them to register first, then add them.");
  const [{ count }] = await systemDb().select({ count: sql<number>`count(*)::int` }).from(schema.memberships).where(eq(schema.memberships.workspaceId, workspaceId));
  await assertCountBelow(workspaceId, "members", count);
  await systemDb().insert(schema.memberships).values({ workspaceId, userId: user.id, role }).onConflictDoUpdate({ target: [schema.memberships.workspaceId, schema.memberships.userId], set: { role } });
  return user;
}

export async function setMemberRole(workspaceId: string, userId: string, role: "owner" | "admin" | "member" | "viewer") {
  if (role !== "owner") await assertNotLastOwner(workspaceId, userId);
  await systemDb().update(schema.memberships).set({ role }).where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)));
}

export async function removeMember(workspaceId: string, userId: string) {
  await assertNotLastOwner(workspaceId, userId);
  await systemDb().delete(schema.memberships).where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)));
}

async function assertNotLastOwner(workspaceId: string, userId: string) {
  const owners = await systemDb().select().from(schema.memberships).where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "owner")));
  if (owners.length === 1 && owners[0].userId === userId) throw new Error("A workspace needs at least one owner.");
}

export async function createWorkspace(userId: string, name: string) {
  return systemDb().transaction(async (tx) => {
    const [ws] = await tx.insert(schema.workspaces).values({ name: name.trim(), settings: { preferredTechnologies: ["WordPress", "Webflow"], targetIndustries: [] } }).returning();
    await tx.insert(schema.memberships).values({ workspaceId: ws.id, userId, role: "owner" });
    const [m] = await tx.insert(schema.targetMarkets).values({ workspaceId: ws.id, name: "Premium Markets", mode: "premium", countries: [...PREMIUM_MARKETS] }).returning();
    await tx.update(schema.workspaces).set({ defaultTargetMarketId: m.id }).where(eq(schema.workspaces.id, ws.id));
    return ws;
  });
}

/** Everything a workspace stores, for data-portability requests. Secrets are excluded. */
export async function exportWorkspaceData(workspaceId: string) {
  return withTenant(workspaceId, async (tx) => {
    const leads = await tx.select({ lead: schema.leads, business: schema.businesses }).from(schema.leads).innerJoin(schema.businesses, eq(schema.businesses.id, schema.leads.businessId)).where(eq(schema.leads.workspaceId, workspaceId));
    const bizIds = leads.map((l) => l.business.id);
    const q = <T>(p: Promise<T>) => p;
    return {
      exportedAt: new Date().toISOString(),
      workspace: (await tx.select({ id: schema.workspaces.id, name: schema.workspaces.name, plan: schema.workspaces.plan, settings: schema.workspaces.settings }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)))[0],
      leads,
      contacts: bizIds.length ? await tx.select().from(schema.contacts).where(sql`${schema.contacts.businessId} in (${sql.join(bizIds.map((i) => sql`${i}`), sql`, `)})`) : [],
      notes: await q(tx.select().from(schema.notes).where(eq(schema.notes.workspaceId, workspaceId))),
      activities: await q(tx.select().from(schema.activities).where(eq(schema.activities.workspaceId, workspaceId))),
      tasks: await q(tx.select().from(schema.tasks).where(eq(schema.tasks.workspaceId, workspaceId))),
      tags: await q(tx.select().from(schema.tags).where(eq(schema.tags.workspaceId, workspaceId))),
      lists: await q(tx.select().from(schema.leadLists).where(eq(schema.leadLists.workspaceId, workspaceId))),
      monitoringRules: await q(tx.select().from(schema.monitoringRules).where(eq(schema.monitoringRules.workspaceId, workspaceId))),
      savedSearches: await q(tx.select().from(schema.savedSearches).where(eq(schema.savedSearches.workspaceId, workspaceId))),
      targetMarkets: await q(tx.select().from(schema.targetMarkets).where(eq(schema.targetMarkets.workspaceId, workspaceId))),
      signals: await q(tx.select().from(schema.businessSignals).where(eq(schema.businessSignals.workspaceId, workspaceId))),
      notifications: await q(tx.select().from(schema.notifications).where(eq(schema.notifications.workspaceId, workspaceId))),
    };
  });
}

/** Permanently delete a workspace and all of its private data (cascades). */
export async function deleteWorkspace(workspaceId: string) {
  await systemDb().delete(schema.jobs).where(eq(schema.jobs.workspaceId, workspaceId));
  await systemDb().delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
}

/**
 * Delete a user account. Workspaces where they are the only member are deleted;
 * the account row is anonymized and sessions are revoked.
 */
export async function deleteAccount(userId: string) {
  const mems = await systemDb().select().from(schema.memberships).where(eq(schema.memberships.userId, userId));
  for (const m of mems) {
    const all = await systemDb().select().from(schema.memberships).where(eq(schema.memberships.workspaceId, m.workspaceId));
    if (all.length === 1) await deleteWorkspace(m.workspaceId);
    else if (m.role === "owner" && all.filter((x) => x.role === "owner").length === 1) {
      const heir = all.find((x) => x.userId !== userId && x.role === "admin") ?? all.find((x) => x.userId !== userId)!;
      await systemDb().update(schema.memberships).set({ role: "owner" }).where(and(eq(schema.memberships.workspaceId, m.workspaceId), eq(schema.memberships.userId, heir.userId)));
    }
  }
  await systemDb().delete(schema.memberships).where(eq(schema.memberships.userId, userId));
  await systemDb().delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await systemDb()
    .update(schema.users)
    .set({ email: `deleted-${userId}@deleted.invalid`, name: "Deleted user", passwordHash: "deleted", deletedAt: new Date(), defaultWorkspaceId: null })
    .where(eq(schema.users.id, userId));
}

/**
 * Honor an opt-out / erasure request about a business: remove its contact details and
 * signals and block future collection by marking it. Applies to shared public records.
 */
export async function suppressBusiness(businessId: string) {
  await systemDb().delete(schema.contacts).where(eq(schema.contacts.businessId, businessId));
  await systemDb().delete(schema.sourceObservations).where(and(eq(schema.sourceObservations.businessId, businessId), sql`${schema.sourceObservations.field} in ('email','phone')`));
  await systemDb().update(schema.businesses).set({ externalKeys: sql`array_append(${schema.businesses.externalKeys}, 'suppressed')`, updatedAt: new Date() }).where(eq(schema.businesses.id, businessId));
}
