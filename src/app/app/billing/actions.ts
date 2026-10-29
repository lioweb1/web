"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { action } from "@/lib/action";
import { schema, systemDb } from "@/lib/db";
import { LIMIT_LABELS, type LimitKey } from "@/lib/plans";

const keys = Object.keys(LIMIT_LABELS) as LimitKey[];
const limitField = z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().int().min(-1).max(10_000_000).optional());

export const saveLimitsAction = action(
  { schema: z.object({ plan: z.enum(["free", "pro", "agency"]), ...Object.fromEntries(keys.map((k) => [k, limitField])) }) as z.ZodType<{ plan: "free" | "pro" | "agency" } & Partial<Record<LimitKey, number>>>, role: "owner", audit: "plan.update" },
  async (ctx, i) => {
    const overrides: Record<string, number> = {};
    for (const k of keys) if (typeof i[k] === "number") overrides[k] = i[k]!;
    await systemDb().update(schema.workspaces).set({ plan: i.plan, limitOverrides: overrides, updatedAt: new Date() }).where(eq(schema.workspaces.id, ctx.workspace.id));
    revalidatePath("/app/billing");
    return { message: "Plan and limits saved." };
  },
);
