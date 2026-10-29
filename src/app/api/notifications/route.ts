import { NextResponse } from "next/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getAuth } from "@/lib/auth/session";
import { schema, withTenant } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Notification feed for the bell / browser notifications (polled every 30s). */
export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limit = Math.min(50, Number(new URL(req.url).searchParams.get("limit") ?? 10) || 10);
  const N = schema.notifications;
  const mine = and(eq(N.workspaceId, ctx.workspace.id), eq(N.userId, ctx.user.id));
  const [items, [{ unread }]] = await withTenant(ctx.workspace.id, (tx) =>
    Promise.all([
      tx.select({ id: N.id, title: N.title, body: N.body, type: N.type, leadId: N.leadId, sourceUrl: N.sourceUrl, readAt: N.readAt, createdAt: N.createdAt }).from(N).where(mine).orderBy(desc(N.createdAt)).limit(limit),
      tx.select({ unread: sql<number>`count(*)::int` }).from(N).where(and(mine, isNull(N.readAt))),
    ]),
  );
  return NextResponse.json({ items, unread }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; id?: string };
  const N = schema.notifications;
  const mine = and(eq(N.workspaceId, ctx.workspace.id), eq(N.userId, ctx.user.id));
  await withTenant(ctx.workspace.id, async (tx) => {
    if (body.action === "read_all") await tx.update(N).set({ readAt: new Date() }).where(and(mine, isNull(N.readAt)));
    else if (body.action === "read" && body.id) await tx.update(N).set({ readAt: new Date() }).where(and(mine, eq(N.id, body.id)));
  });
  return NextResponse.json({ ok: true });
}
