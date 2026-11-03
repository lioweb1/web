import { db, dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Load-balancer health check. Returns 503 if the database is unreachable. */
export async function GET() {
  if (!dbConfigured()) return Response.json({ ok: true, db: "not configured" });
  try {
    await (await db()).query("select 1");
    return Response.json({ ok: true, db: "up" });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}
