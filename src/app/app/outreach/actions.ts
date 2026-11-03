"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";
import { suppressEmail, unsuppressEmail } from "@/lib/services/outreach";

export const suppressEmailAction = action(
  { role: "member", audit: "outreach.suppress", schema: z.object({ email: z.string().trim().email("Enter a valid email address"), note: z.string().trim().max(200).optional() }) },
  async (ctx, i) => {
    await suppressEmail(ctx.workspace.id, i.email, "manual", { note: i.note || null });
    revalidatePath("/app/outreach");
    return { ok: true, message: `${i.email.toLowerCase()} will never be emailed from this workspace.` };
  },
);

export const unsuppressEmailAction = action({ role: "admin", audit: "outreach.unsuppress", schema: z.object({ email: z.string().trim().email() }) }, async (ctx, i) => {
  await unsuppressEmail(ctx.workspace.id, i.email);
  revalidatePath("/app/outreach");
  return { ok: true, message: `${i.email.toLowerCase()} removed from the suppression list.` };
});
