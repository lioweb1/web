"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { action, simpleAction, zUuid } from "@/lib/action";
import { schema, withTenant } from "@/lib/db";
import { createLeadFromSignal } from "@/lib/services/workspace-discovery";
import { isCountryCode } from "@/lib/countries";

export const dismissSignalAction = simpleAction({ schema: z.object({ signalId: zUuid, restore: z.string().optional() }), role: "member" }, async (ctx, i) => {
  await withTenant(ctx.workspace.id, (tx) =>
    tx.update(schema.businessSignals).set({ dismissedAt: i.restore ? null : new Date() }).where(and(eq(schema.businessSignals.id, i.signalId), eq(schema.businessSignals.workspaceId, ctx.workspace.id))),
  );
  revalidatePath("/app/signals");
});

export const createLeadFromSignalAction = action(
  {
    schema: z.object({
      signalId: zUuid,
      name: z.string().trim().min(2, "Enter the business name").max(200),
      website: z.string().trim().max(300).optional(),
      country: z.string().trim().toUpperCase().optional().refine((c) => !c || isCountryCode(c), "Unknown country"),
    }),
    role: "member",
    audit: "lead.create_from_signal",
  },
  async (ctx, i) => {
    const leadId = await createLeadFromSignal(ctx.workspace.id, ctx.user.id, i.signalId, { name: i.name, website: i.website || null, countryCode: i.country || null });
    redirect(`/app/leads/${leadId}`);
  },
);
