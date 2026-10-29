import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { cache } from "react";
import { systemDb, schema } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/security/crypto";

export const SESSION_COOKIE = "lo_session";
const SESSION_DAYS = 30;

export type Role = "owner" | "admin" | "member" | "viewer";
export type AuthContext = {
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string; plan: "free" | "pro" | "agency" };
  role: Role;
};

export async function createSession(userId: string) {
  const token = randomToken();
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await systemDb()
    .insert(schema.sessions)
    .values({
      tokenHash: sha256(token),
      userId,
      expiresAt,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      ip: clientIp(h),
    });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await systemDb().delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

export function clientIp(h: Headers): string | null {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** Resolve the signed-in user and their active workspace. Cached per request. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = systemDb();
  const [row] = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || row.user.deletedAt) return null;
  const user = row.user;

  const wsCookie = (await cookies()).get("lo_ws")?.value;
  const memberships = await db
    .select({ role: schema.memberships.role, workspace: schema.workspaces })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
    .where(eq(schema.memberships.userId, user.id));
  if (memberships.length === 0) return null;
  const active =
    memberships.find((m) => m.workspace.id === wsCookie) ??
    memberships.find((m) => m.workspace.id === user.defaultWorkspaceId) ??
    memberships[0];
  return {
    user: { id: user.id, email: user.email, name: user.name },
    workspace: { id: active.workspace.id, name: active.workspace.name, plan: active.workspace.plan },
    role: active.role,
  };
});

export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function hasRole(ctx: AuthContext, min: Role) {
  return RANK[ctx.role] >= RANK[min];
}

export class ForbiddenError extends Error {
  constructor(msg = "You do not have permission to do that.") {
    super(msg);
  }
}

export async function requireRole(min: Role): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (!hasRole(ctx, min)) throw new ForbiddenError();
  return ctx;
}
