"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/session";
import { systemDb, schema } from "@/lib/db";

export async function switchWorkspaceAction(fd: FormData) {
  const ctx = await requireAuth();
  const id = String(fd.get("workspaceId") ?? "");
  const [m] = await systemDb().select().from(schema.memberships).where(and(eq(schema.memberships.userId, ctx.user.id), eq(schema.memberships.workspaceId, id)));
  if (!m) throw new Error("Not a member of that workspace");
  (await cookies()).set("lo_ws", id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/app/dashboard");
}
