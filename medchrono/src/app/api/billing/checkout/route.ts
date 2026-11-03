import { createCheckout, stripeConfigured } from "@/lib/billing";
import { baseUrl, errorResponse, guard, json, readJson } from "@/lib/http";
import { isProduct } from "@/lib/plans";

export async function POST(req: Request) {
  const g = await guard(req, { auth: true });
  if (g.error) return g.error;
  if (g.user!.role !== "owner") return json({ error: "Only account owners can manage billing." }, 403);
  if (!stripeConfigured()) return json({ error: "Payments are not configured yet (STRIPE_SECRET_KEY)." }, 503);
  const { product } = await readJson(req);
  if (!isProduct(product)) return json({ error: "Unknown product." }, 400);
  if (product === "firm" && g.user!.org.plan === "firm" && g.user!.org.subscription_status === "active") {
    return json({ error: "You're already on the Firm plan. Use “Manage subscription” to change it." }, 409);
  }
  try {
    return json({ url: await createCheckout(g.user!, product, baseUrl(req)) });
  } catch (e) {
    return errorResponse(e);
  }
}
