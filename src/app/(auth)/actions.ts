"use server";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate, registerUser, AuthError } from "@/lib/services/accounts";
import { createSession, destroySession, clientIp } from "@/lib/auth/session";
import { rateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { audit } from "@/lib/services/audit";
import { formToObject, type ActionState } from "@/lib/action";

const loginSchema = z.object({ email: z.string().trim().email("Enter a valid email").max(254), password: z.string().min(1, "Enter your password").max(200), next: z.string().optional() });

const safeNext = (n?: string) => (n && n.startsWith("/app") && !n.startsWith("//") ? n : "/app/dashboard");

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ip = clientIp(await headers()) ?? "unknown";
  const parsed = loginSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await rateLimit(`login:ip:${ip}`, 20, 900);
    await rateLimit(`login:email:${parsed.data.email.toLowerCase()}`, 8, 900);
    const user = await authenticate(parsed.data.email, parsed.data.password);
    await createSession(user.id);
    await audit({ workspaceId: user.defaultWorkspaceId, userId: user.id, action: "auth.login", ip });
  } catch (e) {
    if (e instanceof AuthError || e instanceof RateLimitError) return { error: e.message };
    console.error(e);
    return { error: "Sign-in failed. Please try again." };
  }
  redirect(safeNext(parsed.data.next));
}

const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.string().trim().email("Enter a valid email").max(254),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  workspaceName: z.string().trim().max(100).optional(),
  accept: z.literal("on", { message: "Please accept the terms and privacy policy" }),
});

export async function registerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ip = clientIp(await headers()) ?? "unknown";
  const parsed = registerSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await rateLimit(`register:ip:${ip}`, 10, 3600);
    const { user, workspace } = await registerUser(parsed.data);
    await createSession(user.id);
    await audit({ workspaceId: workspace.id, userId: user.id, action: "auth.register", ip });
  } catch (e) {
    if (e instanceof AuthError || e instanceof RateLimitError) return { error: e.message };
    console.error(e);
    return { error: "Registration failed. Please try again." };
  }
  redirect("/app/dashboard?welcome=1");
}

export async function logoutAction() {
  await destroySession();
  (await cookies()).delete("lo_ws");
  redirect("/login");
}
