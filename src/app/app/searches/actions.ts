"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { simpleAction } from "@/lib/action";
import { schema, withTenant } from "@/lib/db";

export const renameSearchAction = simpleAction({ role: "member", schema: z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(80) }) }, async (ctx, i) => {
  await withTenant(ctx.workspace.id, (tx) =>
    tx.update(schema.savedSearches).set({ name: i.name, updatedAt: new Date() }).where(and(eq(schema.savedSearches.id, i.id), eq(schema.savedSearches.workspaceId, ctx.workspace.id))),
  );
  revalidatePath("/app/searches");
});

export const deleteSearchAction = simpleAction({ role: "member", schema: z.object({ id: z.string().uuid() }) }, async (ctx, i) => {
  await withTenant(ctx.workspace.id, (tx) => tx.delete(schema.savedSearches).where(and(eq(schema.savedSearches.id, i.id), eq(schema.savedSearches.workspaceId, ctx.workspace.id))));
  revalidatePath("/app/searches");
});

export const clearHistoryAction = simpleAction({ role: "viewer", schema: z.object({}) }, async (ctx) => {
  await withTenant(ctx.workspace.id, (tx) => tx.delete(schema.searchHistory).where(and(eq(schema.searchHistory.workspaceId, ctx.workspace.id), eq(schema.searchHistory.userId, ctx.user.id))));
  revalidatePath("/app/searches");
});
