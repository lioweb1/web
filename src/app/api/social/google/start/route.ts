import { NextResponse } from "next/server";
import { getAuth, hasRole } from "@/lib/auth/session";
import { GOOGLE_STATE_COOKIE, googleAuthStart } from "@/lib/social/google";

export const dynamic = "force-dynamic";

/** "Sign in with Google": redirect to Google's consent screen. */
export async function GET(req: Request) {
  const back = new URL("/app/social/settings", req.url);
  const ctx = await getAuth();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  if (!hasRole(ctx, "admin")) {
    back.searchParams.set("google", "error");
    back.searchParams.set("reason", "Only workspace admins can connect Google.");
    return NextResponse.redirect(back);
  }
  try {
    const { url, nonce } = await googleAuthStart(ctx.workspace.id, ctx.user.id);
    const res = NextResponse.redirect(url);
    res.cookies.set(GOOGLE_STATE_COOKIE, nonce, { httpOnly: true, sameSite: "lax", secure: (process.env.APP_URL ?? "").startsWith("https://"), path: "/api/social/google", maxAge: 600 });
    return res;
  } catch (e) {
    back.searchParams.set("google", "error");
    back.searchParams.set("reason", e instanceof Error ? e.message : String(e));
    return NextResponse.redirect(back);
  }
}
