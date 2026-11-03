import { getStripe, handleStripeEvent, stripeConfigured } from "@/lib/billing";

export const runtime = "nodejs";

/** Stripe → us. Verifies the signature on the raw body before touching any credits. */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeConfigured() || !secret) return new Response("Stripe not configured", { status: 503 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });
  const body = await req.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  try {
    await handleStripeEvent(event);
    return Response.json({ received: true });
  } catch (e) {
    console.error("stripe webhook failed", event.type, e);
    return new Response("Handler error", { status: 500 });
  }
}
