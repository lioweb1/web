import { changeRole, removeMember } from "@/lib/account";
import { errorResponse, guard, json, readJson } from "@/lib/http";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req, { auth: true });
  if (g.error) return g.error;
  try {
    await removeMember(g.user!, (await ctx.params).id);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req, { auth: true });
  if (g.error) return g.error;
  const b = await readJson(req);
  try {
    await changeRole(g.user!, (await ctx.params).id, String(b.role ?? ""));
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
