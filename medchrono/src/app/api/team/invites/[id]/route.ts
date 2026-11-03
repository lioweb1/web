import { revokeInvite } from "@/lib/account";
import { errorResponse, guard, json } from "@/lib/http";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req, { auth: true });
  if (g.error) return g.error;
  try {
    await revokeInvite(g.user!, (await ctx.params).id);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
