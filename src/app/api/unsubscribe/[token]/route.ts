import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/services/outreach";

export const dynamic = "force-dynamic";

/**
 * RFC 8058 one-click unsubscribe target. Mail clients POST here (form body
 * "List-Unsubscribe=One-Click") when the user clicks their client's unsubscribe button.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await unsubscribeByToken(token);
  return res.ok ? new NextResponse(null, { status: 200 }) : NextResponse.json({ error: "unknown token" }, { status: 404 });
}
