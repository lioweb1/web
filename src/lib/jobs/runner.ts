import { claimJob, completeJob, failJob, type JobType } from "./queue";
import { handlers, isPermanent } from "./handlers";

/** Process jobs until none are due or the time budget is spent. Returns the number processed. */
export async function runJobs(opts: { workerId: string; budgetMs?: number; max?: number; types?: JobType[] }) {
  const deadline = Date.now() + (opts.budgetMs ?? 25_000);
  let processed = 0;
  while (Date.now() < deadline && processed < (opts.max ?? Infinity)) {
    const job = await claimJob(opts.workerId, opts.types);
    if (!job) break;
    processed++;
    const handler = handlers[job.type];
    if (!handler) {
      await failJob(job, `No handler for job type ${job.type}`, { permanent: true });
      continue;
    }
    try {
      const result = await handler(job);
      await completeJob(job.id, result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await failJob(job, msg, { permanent: isPermanent(e) });
      if (process.env.NODE_ENV !== "test") console.error(`[job ${job.type} ${job.id}] attempt ${job.attempts} failed: ${msg}`);
    }
  }
  return processed;
}
