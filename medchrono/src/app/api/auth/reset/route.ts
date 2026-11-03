import { cookies } from "next/headers";
import { resetPassword } from "@/lib/account";
import { sessionCookie } from "@/lib/auth";
import { errorResponse, guard, json, readJson } from "@/lib/http";

export async function POST(req: Request) {
  const g = await guard(req, { auth: false });
  if (g.error) return g.error;
  const b = await readJson(req);
  try {
    const s = await resetPassword(String(b.token ?? ""), String(b.password ?? ""));
    (await cookies()).set(sessionCookie(s.token, s.expires));
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
