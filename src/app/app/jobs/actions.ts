"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { simpleAction, zUuid } from "@/lib/action";
import { cancelJob, retryJob } from "@/lib/jobs/queue";

export const retryJobAction = simpleAction({ schema: z.object({ jobId: zUuid }), role: "member", audit: "job.retry" }, async (ctx, i) => {
  await retryJob(ctx.workspace.id, i.jobId);
  revalidatePath("/app/jobs");
});

export const cancelJobAction = simpleAction({ schema: z.object({ jobId: zUuid }), role: "member", audit: "job.cancel" }, async (ctx, i) => {
  await cancelJob(ctx.workspace.id, i.jobId);
  revalidatePath("/app/jobs");
});
