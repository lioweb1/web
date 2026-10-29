import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuth, clientIp } from "@/lib/auth/session";
import { parseFilters } from "@/lib/services/leads";
import { buildExport, EXPORT_FIELDS, type ContactFilter } from "@/lib/services/export";
import { audit } from "@/lib/services/audit";
import { LimitExceededError } from "@/lib/plans";
import { rateLimit, RateLimitError } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/leads/export?<lead filters>&fields=a,b&contact=email&format=excel&delimiter=;
 * Streams a CSV of real stored leads matching the filters (or `ids`). Any member role may export.
 */
export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const filters = parseFilters(sp);
  const fields = (sp.get("fields") ?? "").split(",").filter(Boolean);
  const contact = (["any", "email", "phone", "email_or_phone"].includes(sp.get("contact") ?? "") ? sp.get("contact") : "any") as ContactFilter;
  const format = sp.get("format") === "excel" ? "excel" : "csv";
  const delimiter = sp.get("delimiter") === ";" ? ";" : ",";
  try {
    await rateLimit(`export:${ctx.user.id}`, 30, 3600);
    const { csv, rowCount } = await buildExport(ctx.workspace.id, ctx.user.id, filters, {
      fields: fields.length ? fields : EXPORT_FIELDS.filter((f) => f.default).map((f) => f.key),
      contact,
      format,
      delimiter,
    });
    await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "leads.export", metadata: { rowCount, format, fields }, ip: clientIp(await headers()) });
    const name = `leadorbit-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const status = e instanceof LimitExceededError || e instanceof RateLimitError ? 429 : 400;
    const message = e instanceof Error && !/Failed query/.test(e.message) ? e.message : "Export failed";
    return NextResponse.json({ error: message }, { status });
  }
}
