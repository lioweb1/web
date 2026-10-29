import { and, eq, sql, lt, inArray } from "drizzle-orm";
import { schema, systemDb } from "@/lib/db";

export type JobType =
  | "discovery_run"
  | "qualify_business"
  | "enrich_lead"
  | "analyze_business"
  | "send_notification_email"
  | "send_digest"
  | "deliver_webhook"
  | "push_crm"
  | "task_reminders";

export type EnqueueInput = {
  type: JobType;
  workspaceId: string | null;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
  /** Duplicate enqueues with the same key are ignored (idempotency). */
  idempotencyKey?: string;
};

export async function enqueue(input: EnqueueInput) {
  const [row] = await systemDb()
    .insert(schema.jobs)
    .values({
      type: input.type,
      workspaceId: input.workspaceId,
      payload: input.payload ?? {},
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 4,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export type Job = typeof schema.jobs.$inferSelect;

/** Claim the next due job atomically (FOR UPDATE SKIP LOCKED: safe with many workers). */
export async function claimJob(workerId: string, types?: JobType[]): Promise<Job | null> {
  const typeFilter = types?.length ? sql`and type in (${sql.join(types.map((t) => sql`${t}`), sql`, `)})` : sql``;
  const res = await systemDb().execute<Record<string, unknown>>(sql`
    update jobs set status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1,
      started_at = coalesce(started_at, now()), updated_at = now()
    where id = (
      select id from jobs where status = 'queued' and run_at <= now() ${typeFilter}
      order by run_at limit 1 for update skip locked
    )
    returning id
  `);
  const id = res.rows[0]?.id as string | undefined;
  if (!id) return null;
  const [job] = await systemDb().select().from(schema.jobs).where(eq(schema.jobs.id, id));
  return job;
}

export async function completeJob(id: string, result: Record<string, unknown>) {
  await systemDb().update(schema.jobs).set({ status: "succeeded", result, lastError: null, finishedAt: new Date(), lockedAt: null, lockedBy: null, updatedAt: new Date() }).where(eq(schema.jobs.id, id));
}

/** Exponential backoff: 30s, 2m, 8m, 32m… capped at 6h. Permanent errors go straight to dead. */
export function backoffMs(attempt: number) {
  return Math.min(30_000 * 4 ** (attempt - 1), 6 * 3600_000);
}

export async function failJob(job: Job, error: string, opts: { permanent?: boolean } = {}) {
  const dead = opts.permanent || job.attempts >= job.maxAttempts;
  await systemDb()
    .update(schema.jobs)
    .set({
      status: dead ? "dead" : "queued",
      lastError: error.slice(0, 2000),
      runAt: dead ? job.runAt : new Date(Date.now() + backoffMs(job.attempts)),
      finishedAt: dead ? new Date() : null,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, job.id));
  return dead;
}

/** Re-queue jobs whose worker died mid-run (lock older than the timeout). */
export async function recoverStaleJobs(timeoutMinutes = 15) {
  const res = await systemDb()
    .update(schema.jobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null, lastError: "Worker stopped while running; re-queued", updatedAt: new Date() })
    .where(and(eq(schema.jobs.status, "running"), lt(schema.jobs.lockedAt, new Date(Date.now() - timeoutMinutes * 60_000))))
    .returning({ id: schema.jobs.id });
  return res.length;
}

/** Manual retry from the UI (workspace-scoped). */
export async function retryJob(workspaceId: string, jobId: string) {
  const res = await systemDb()
    .update(schema.jobs)
    .set({ status: "queued", runAt: new Date(), attempts: 0, lastError: null, finishedAt: null, updatedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.workspaceId, workspaceId), inArray(schema.jobs.status, ["failed", "dead", "cancelled"])))
    .returning({ id: schema.jobs.id });
  return res.length > 0;
}

export async function cancelJob(workspaceId: string, jobId: string) {
  const res = await systemDb()
    .update(schema.jobs)
    .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.workspaceId, workspaceId), eq(schema.jobs.status, "queued")))
    .returning({ id: schema.jobs.id });
  return res.length > 0;
}
