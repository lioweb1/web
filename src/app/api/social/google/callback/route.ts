import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuth, hasRole } from "@/lib/auth/session";
import { audit } from "@/lib/services/audit";
import { GOOGLE_STATE_COOKIE, googleAuthFinish, verifyGoogleState } from "@/lib/social/google";

export const dynamic = "force-dynamic";

/** Google redirects back here with ?code=…&state=… after consent. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = new URL("/app/social/settings", req.url);
  const fail = (reason: string) => {
    back.searchParams.set("google", "error");
    back.searchParams.set("reason", reason.slice(0, 300));
    const res = NextResponse.redirect(back);
    res.cookies.delete({ name: GOOGLE_STATE_COOKIE, path: "/api/social/google" });
    return res;
  };
  const ctx = await getAuth();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  if (url.searchParams.get("error")) return fail(`Google: ${url.searchParams.get("error")}`);
  const state = verifyGoogleState(url.searchParams.get("state") ?? "", (await cookies()).get(GOOGLE_STATE_COOKIE)?.value);
  // The state must come from this browser and belong to the signed-in admin's workspace.
  if (!state || state.workspaceId !== ctx.workspace.id || state.userId !== ctx.user.id || !hasRole(ctx, "admin")) return fail("The sign-in link expired or was not started here. Please try again.");
  const code = url.searchParams.get("code");
  if (!code) return fail("Google did not return an authorization code.");
  try {
    const { email } = await googleAuthFinish(ctx.workspace.id, code);
    await audit({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "social.google.connect", targetType: "integration", targetId: "social:google", metadata: { email } });
    back.searchParams.set("google", "connected");
    const res = NextResponse.redirect(back);
    res.cookies.delete({ name: GOOGLE_STATE_COOKIE, path: "/api/social/google" });
    return res;
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
