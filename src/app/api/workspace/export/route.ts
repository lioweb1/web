import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuth, hasRole, clientIp } from "@/lib/auth/session";
import { exportWorkspaceData } from "@/lib/services/accounts";
import { audit } from "@/lib/services/audit";
import { rateLimit, RateLimitError } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/** Full workspace data export (data portability). Admins only; secrets are never included. */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasRole(ctx, "admin")) return NextResponse.json({ error: "Only workspace admins can export all data." }, { status: 403 });
  try {
    await rateLimit(`ws-export:${ctx.workspace.id}`, 5, 3600);
  } catch (e) {
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: 429 });
    throw e;
  }
  const data = await exportWorkspaceData(ctx.workspace.id);
  await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "workspace.export", metadata: { leads: data.leads.length }, ip: clientIp(await headers()) });
  const name = `leadorbit-workspace-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
