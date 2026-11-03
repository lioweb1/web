import { cookies } from "next/headers";
import { sessionCookie, signUp } from "@/lib/auth";
import { errorResponse, guard, json, readJson } from "@/lib/http";

export async function POST(req: Request) {
  const g = await guard(req, { auth: false });
  if (g.error) return g.error;
  const b = await readJson(req);
  try {
    const s = await signUp({ email: String(b.email ?? ""), password: String(b.password ?? ""), name: String(b.name ?? ""), firm: String(b.firm ?? ""), acceptTerms: b.accept_terms === true || b.accept_terms === "on" });
    (await cookies()).set(sessionCookie(s.token, s.expires));
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
