import { requestPasswordReset } from "@/lib/account";
import { baseUrl, errorResponse, guard, json, readJson } from "@/lib/http";

export async function POST(req: Request) {
  const g = await guard(req, { auth: false });
  if (g.error) return g.error;
  const { email } = await readJson(req);
  try {
    await requestPasswordReset(String(email ?? ""), baseUrl(req));
    // Same answer whether or not the account exists.
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
