import { cookies } from "next/headers";
import { SESSION_COOKIE, deleteSession, sameOrigin } from "@/lib/auth";
import { dbConfigured } from "@/lib/db";
import { json } from "@/lib/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Cross-site request blocked." }, 403);
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token && dbConfigured()) await deleteSession(token);
  jar.delete(SESSION_COOKIE);
  return json({ ok: true });
}
