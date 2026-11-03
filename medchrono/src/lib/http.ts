import { AuthError, requestUser, sameOrigin, type SessionUser } from "./auth";
import { dbConfigured } from "./db";

export const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/** Shared guard for mutating JSON endpoints: same-origin + optional auth. */
export async function guard(req: Request, opts: { auth: boolean }): Promise<{ user: SessionUser | null; error?: Response }> {
  if (!dbConfigured()) return { user: null, error: json({ error: "DATABASE_URL is not configured on the server." }, 503) };
  if (!sameOrigin(req)) return { user: null, error: json({ error: "Cross-site request blocked." }, 403) };
  if (!opts.auth) return { user: null };
  const user = await requestUser(req);
  if (!user) return { user: null, error: json({ error: "Please sign in." }, 401) };
  return { user };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof AuthError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: "Something went wrong. Please try again." }, 500);
}

export function baseUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}
