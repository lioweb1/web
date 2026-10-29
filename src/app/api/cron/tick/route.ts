import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { schedulerTick } from "@/lib/jobs/scheduler";
import { runJobs } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * For hosts without a long-running worker (e.g. serverless): call every minute from an
 * external cron with `Authorization: Bearer $CRON_SECRET`. Runs the scheduler and processes
 * jobs for up to ~45 seconds.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tick = await schedulerTick();
  const processed = await runJobs({ workerId: "cron-route", budgetMs: 45_000 });
  return NextResponse.json({ ...tick, processed });
}

export const GET = POST;
