import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, userFromToken, type SessionUser } from "./auth";
import { dbConfigured } from "./db";

/** The signed-in user for a server component, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  // Read cookies first: it marks the route as dynamic even when no database is configured at build time.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!dbConfigured()) return null;
  return userFromToken(token);
}

export async function requireUser(next: string): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(next)}`);
  return u;
}
