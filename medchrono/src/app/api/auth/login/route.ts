import { cookies } from "next/headers";
import { clientIp, logIn, sessionCookie } from "@/lib/auth";
import { errorResponse, guard, json, readJson } from "@/lib/http";

export async function POST(req: Request) {
  const g = await guard(req, { auth: false });
  if (g.error) return g.error;
  const b = await readJson(req);
  try {
    const s = await logIn(String(b.email ?? ""), String(b.password ?? ""), clientIp(req));
    (await cookies()).set(sessionCookie(s.token, s.expires));
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
