import { inviteMember } from "@/lib/account";
import { baseUrl, errorResponse, guard, json, readJson } from "@/lib/http";

export async function POST(req: Request) {
  const g = await guard(req, { auth: true });
  if (g.error) return g.error;
  const b = await readJson(req);
  try {
    const r = await inviteMember(g.user!, String(b.email ?? ""), String(b.role ?? "member"), baseUrl(req));
    // Without email delivery, hand the link to the (owner) inviter so they can send it themselves.
    return json({ ok: true, emailed: r.emailed, url: r.emailed ? undefined : r.url });
  } catch (e) {
    return errorResponse(e);
  }
}
