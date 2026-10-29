/**
 * Background worker: runs the scheduler every 30s and processes queued jobs continuously.
 * Start with `npm run worker`. Run several for throughput — job claiming uses SKIP LOCKED.
 */
import { hostname } from "node:os";
import { runJobs } from "@/lib/jobs/runner";
import { schedulerTick } from "@/lib/jobs/scheduler";
import { closeDb } from "@/lib/db";

const workerId = `${hostname()}:${process.pid}`;
let stopping = false;

async function loop() {
  let lastTick = 0;
  console.log(`[worker] ${workerId} started`);
  while (!stopping) {
    try {
      if (Date.now() - lastTick > 30_000) {
        lastTick = Date.now();
        const s = await schedulerTick();
        if (s.rulesQueued || s.recovered) console.log(`[scheduler] queued ${s.rulesQueued} rule runs, recovered ${s.recovered} stale jobs`);
      }
      const n = await runJobs({ workerId, budgetMs: 20_000 });
      if (n === 0) await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.error("[worker] loop error", e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await closeDb();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} received, finishing current job…`);
    stopping = true;
  });
}

loop();
