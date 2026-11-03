import { createPortal, stripeConfigured } from "@/lib/billing";
import { baseUrl, errorResponse, guard, json } from "@/lib/http";

export async function POST(req: Request) {
  const g = await guard(req, { auth: true });
  if (g.error) return g.error;
  if (!stripeConfigured()) return json({ error: "Payments are not configured yet (STRIPE_SECRET_KEY)." }, 503);
  try {
    return json({ url: await createPortal(g.user!, baseUrl(req)) });
  } catch (e) {
    return errorResponse(e);
  }
}
