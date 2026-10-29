"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { action, zArr, zCsv, zInt, zUuid, UserError } from "@/lib/action";
import { schema, systemDb, withTenant } from "@/lib/db";
import { createSession, destroySession, hasRole } from "@/lib/auth/session";
import { addMember, authenticate, changePassword, createWorkspace, deleteAccount, deleteWorkspace, removeMember, setMemberRole, AuthError } from "@/lib/services/accounts";
import { encryptSecret, randomToken } from "@/lib/security/crypto";
import { PREMIUM_MARKETS, isCountryCode } from "@/lib/countries";
import { audit } from "@/lib/services/audit";

const done = (tab: string, message: string) => {
  revalidatePath("/app/settings");
  return { message, data: { tab } };
};

/* Profile */
export const updateProfileAction = action({ schema: z.object({ name: z.string().trim().min(1).max(100) }) }, async (ctx, i) => {
  await systemDb().update(schema.users).set({ name: i.name, updatedAt: new Date() }).where(eq(schema.users.id, ctx.user.id));
  revalidatePath("/app", "layout");
  return done("profile", "Profile updated.");
});

export const changePasswordAction = action(
  { schema: z.object({ current: z.string().min(1).max(200), next: z.string().min(10, "Use at least 10 characters").max(200), confirm: z.string() }).refine((v) => v.next === v.confirm, { message: "Passwords do not match", path: ["confirm"] }), audit: "auth.password_change" },
  async (ctx, i) => {
    try {
      await changePassword(ctx.user.id, i.current, i.next);
    } catch (e) {
      if (e instanceof AuthError) return { error: e.message };
      throw e;
    }
    await createSession(ctx.user.id); // other sessions were revoked
    return done("profile", "Password changed. You were signed out on other devices.");
  },
);

/* Workspace */
export const updateWorkspaceAction = action(
  { schema: z.object({ name: z.string().trim().min(1).max(100), preferredTechnologies: zCsv, targetIndustries: zCsv, services: zCsv }), role: "admin", audit: "workspace.update" },
  async (ctx, i) => {
    const [ws] = await systemDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspace.id));
    const clip = (a: string[]) => a.map((s) => s.slice(0, 60)).slice(0, 30);
    await systemDb()
      .update(schema.workspaces)
      .set({ name: i.name, settings: { ...ws.settings, preferredTechnologies: clip(i.preferredTechnologies), targetIndustries: clip(i.targetIndustries), services: clip(i.services) }, updatedAt: new Date() })
      .where(eq(schema.workspaces.id, ctx.workspace.id));
    revalidatePath("/app", "layout");
    return done("workspace", "Workspace settings saved. Lead scores update the next time leads are re-scored.");
  },
);

export const createWorkspaceAction = action({ schema: z.object({ name: z.string().trim().min(1).max(100) }), audit: "workspace.create" }, async (ctx, i) => {
  const ws = await createWorkspace(ctx.user.id, i.name);
  (await cookies()).set("lo_ws", ws.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/app/dashboard?welcome=1");
});

/* Members */
const role = z.enum(["owner", "admin", "member", "viewer"]);

export const addMemberAction = action({ schema: z.object({ email: z.string().trim().email(), role: z.enum(["admin", "member", "viewer"]) }), role: "admin", audit: "member.add" }, async (ctx, i) => {
  await addMember(ctx.workspace.id, i.email, i.role);
  return done("members", `${i.email} added as ${i.role}.`);
});

async function targetRole(workspaceId: string, userId: string) {
  const [m] = await systemDb().select().from(schema.memberships).where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)));
  if (!m) throw new UserError("Member not found");
  return m.role;
}

export const setRoleAction = action({ schema: z.object({ userId: zUuid, role }), role: "admin", audit: "member.role_change" }, async (ctx, i) => {
  const current = await targetRole(ctx.workspace.id, i.userId);
  if ((current === "owner" || i.role === "owner") && !hasRole(ctx, "owner")) return { error: "Only owners can grant or remove the owner role." };
  await setMemberRole(ctx.workspace.id, i.userId, i.role);
  return done("members", "Role updated.");
});

export const removeMemberAction = action({ schema: z.object({ userId: zUuid }), role: "admin", audit: "member.remove" }, async (ctx, i) => {
  const current = await targetRole(ctx.workspace.id, i.userId);
  if (current === "owner" && !hasRole(ctx, "owner")) return { error: "Only owners can remove an owner." };
  await removeMember(ctx.workspace.id, i.userId);
  return done("members", "Member removed.");
});

/* Target markets */
export const saveMarketAction = action(
  { schema: z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(80), mode: z.enum(["premium", "all", "custom"]), countries: zCsv, regions: zCsv, cities: zCsv, makeDefault: z.string().optional() }), audit: "market.save" },
  async (ctx, i) => {
    const countries = i.mode === "all" ? [] : i.mode === "premium" && i.countries.length === 0 ? [...PREMIUM_MARKETS] : i.countries.map((c) => c.toUpperCase());
    if (countries.some((c) => !isCountryCode(c))) return { error: "Unknown country code." };
    if (i.mode !== "all" && countries.length === 0) return { error: "Select at least one country, or choose “All countries”." };
    const values = { name: i.name, mode: i.mode, countries, regions: i.regions.slice(0, 50), cities: i.cities.slice(0, 100), updatedAt: new Date() };
    const id = await withTenant(ctx.workspace.id, async (tx) => {
      if (i.id) {
        const [m] = await tx.update(schema.targetMarkets).set(values).where(and(eq(schema.targetMarkets.id, i.id), eq(schema.targetMarkets.workspaceId, ctx.workspace.id))).returning();
        if (!m) throw new UserError("Target market not found");
        return m.id;
      }
      const [m] = await tx.insert(schema.targetMarkets).values({ workspaceId: ctx.workspace.id, ...values }).returning();
      return m.id;
    });
    if (i.makeDefault === "on") await systemDb().update(schema.workspaces).set({ defaultTargetMarketId: id }).where(eq(schema.workspaces.id, ctx.workspace.id));
    return done("markets", "Target market saved.");
  },
);

export const deleteMarketAction = action({ schema: z.object({ id: zUuid }), audit: "market.delete" }, async (ctx, i) => {
  const [ws] = await systemDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspace.id));
  if (ws.defaultTargetMarketId === i.id) return { error: "This is your default target market. Make another market the default first." };
  await withTenant(ctx.workspace.id, (tx) => tx.delete(schema.targetMarkets).where(and(eq(schema.targetMarkets.id, i.id), eq(schema.targetMarkets.workspaceId, ctx.workspace.id))));
  return done("markets", "Target market deleted.");
});

export const setDefaultMarketAction = action({ schema: z.object({ id: zUuid }), role: "admin", audit: "market.default" }, async (ctx, i) => {
  const [m] = await withTenant(ctx.workspace.id, (tx) => tx.select().from(schema.targetMarkets).where(eq(schema.targetMarkets.id, i.id)));
  if (!m) return { error: "Target market not found" };
  await systemDb().update(schema.workspaces).set({ defaultTargetMarketId: m.id }).where(eq(schema.workspaces.id, ctx.workspace.id));
  return done("markets", `${m.name} is now the default target market.`);
});

export const restorePremiumAction = action({ schema: z.object({}), audit: "market.restore_premium" }, async (ctx) => {
  await withTenant(ctx.workspace.id, async (tx) => {
    const [existing] = await tx.select().from(schema.targetMarkets).where(and(eq(schema.targetMarkets.workspaceId, ctx.workspace.id), eq(schema.targetMarkets.name, "Premium Markets")));
    if (existing) await tx.update(schema.targetMarkets).set({ mode: "premium", countries: [...PREMIUM_MARKETS], regions: [], cities: [], updatedAt: new Date() }).where(eq(schema.targetMarkets.id, existing.id));
    else await tx.insert(schema.targetMarkets).values({ workspaceId: ctx.workspace.id, name: "Premium Markets", mode: "premium", countries: [...PREMIUM_MARKETS] });
  });
  return done("markets", "Premium Markets preset restored to its 18 default countries.");
});

/* Webhooks */
const EVENTS = ["lead.created", "lead.qualified", "lead.status_changed"] as const;

export const createWebhookAction = action(
  {
    schema: z.object({
      url: z.string().trim().url().max(500).refine((u) => u.startsWith("https://"), "Webhook URLs must use https://"),
      events: zArr.pipe(z.array(z.enum(EVENTS)).min(1, "Select at least one event")),
      minScore: zInt(0, 100),
    }),
    role: "admin",
    audit: "webhook.create",
  },
  async (ctx, i) => {
    const secret = `whsec_${randomToken(24)}`;
    await withTenant(ctx.workspace.id, (tx) => tx.insert(schema.webhooks).values({ workspaceId: ctx.workspace.id, url: i.url, events: i.events, minScore: i.minScore, encryptedSecret: encryptSecret(secret) }));
    revalidatePath("/app/settings");
    return { message: "Webhook created. Copy the signing secret now — it will not be shown again.", data: { tab: "webhooks", secret } };
  },
);

export const toggleWebhookAction = action({ schema: z.object({ id: zUuid, active: z.enum(["0", "1"]) }), role: "admin", audit: "webhook.toggle" }, async (ctx, i) => {
  await withTenant(ctx.workspace.id, (tx) => tx.update(schema.webhooks).set({ active: i.active === "1", updatedAt: new Date() }).where(and(eq(schema.webhooks.id, i.id), eq(schema.webhooks.workspaceId, ctx.workspace.id))));
  return done("webhooks", i.active === "1" ? "Webhook enabled." : "Webhook paused.");
});

export const deleteWebhookAction = action({ schema: z.object({ id: zUuid }), role: "admin", audit: "webhook.delete" }, async (ctx, i) => {
  await withTenant(ctx.workspace.id, (tx) => tx.delete(schema.webhooks).where(and(eq(schema.webhooks.id, i.id), eq(schema.webhooks.workspaceId, ctx.workspace.id))));
  return done("webhooks", "Webhook deleted.");
});

/* Privacy & data */
export const deleteWorkspaceAction = action({ schema: z.object({ confirm: z.string() }), role: "owner" }, async (ctx, i) => {
  if (i.confirm.trim() !== ctx.workspace.name) return { error: "Type the exact workspace name to confirm." };
  await audit({ workspaceId: null, userId: ctx.user.id, action: "workspace.delete", targetType: "workspace", targetId: ctx.workspace.id, metadata: { name: ctx.workspace.name } });
  await deleteWorkspace(ctx.workspace.id);
  const jar = await cookies();
  jar.delete("lo_ws");
  const [{ n }] = (await systemDb().execute<{ n: number }>(sql`select count(*)::int as n from memberships where user_id = ${ctx.user.id}`)).rows;
  if (Number(n) === 0) {
    const ws = await createWorkspace(ctx.user.id, "My workspace");
    await systemDb().update(schema.users).set({ defaultWorkspaceId: ws.id }).where(eq(schema.users.id, ctx.user.id));
  }
  redirect("/app/dashboard");
});

export const deleteAccountAction = action({ schema: z.object({ password: z.string().min(1), confirm: z.string() }) }, async (ctx, i) => {
  if (i.confirm.trim() !== "DELETE") return { error: "Type DELETE to confirm." };
  try {
    await authenticate(ctx.user.email, i.password);
  } catch {
    return { error: "Password is incorrect." };
  }
  await audit({ workspaceId: null, userId: null, action: "account.delete", targetType: "user", targetId: ctx.user.id });
  await deleteAccount(ctx.user.id);
  await destroySession();
  (await cookies()).delete("lo_ws");
  redirect("/?deleted=1");
});
