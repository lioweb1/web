import Stripe from "stripe";
import { db, tx } from "./db";
import { addPurchasedCredits, renewPlanCredits } from "./credits";
import { FIRM_PLAN, PACKS, isProduct, type ProductId } from "./plans";
import type { SessionUser } from "./auth";
import { env } from "./env";

let stripe: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(env("STRIPE_SECRET_KEY"));
}

export function getStripe(): Stripe {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  stripe ??= new Stripe(key);
  return stripe;
}

async function ensureCustomer(user: SessionUser): Promise<string> {
  if (user.org.stripe_customer_id) return user.org.stripe_customer_id;
  const customer = await getStripe().customers.create({
    email: user.email,
    name: user.org.name,
    metadata: { org_id: user.org.id },
  });
  // Another request may have created one at the same time; keep the first.
  const { rows } = await (await db()).query(
    "update orgs set stripe_customer_id = coalesce(stripe_customer_id, $2) where id = $1 returning stripe_customer_id",
    [user.org.id, customer.id],
  );
  return rows[0].stripe_customer_id;
}

/** Creates a hosted Stripe Checkout page. Prices are defined in code (src/lib/plans.ts), so no dashboard setup is needed. */
export async function createCheckout(user: SessionUser, product: ProductId, baseUrl: string): Promise<string> {
  const customer = await ensureCustomer(user);
  const metadata = { org_id: user.org.id, product };
  const common = {
    customer,
    client_reference_id: user.org.id,
    metadata,
    success_url: `${baseUrl}/billing?status=success`,
    cancel_url: `${baseUrl}/billing?status=cancelled`,
    allow_promotion_codes: true,
  } satisfies Stripe.Checkout.SessionCreateParams;

  const session =
    product === "firm"
      ? await getStripe().checkout.sessions.create({
          ...common,
          mode: "subscription",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: FIRM_PLAN.amount,
                recurring: { interval: "month" },
                product_data: { name: `MedChrono AI — Firm plan (${FIRM_PLAN.credits} cases / month)` },
              },
            },
          ],
          subscription_data: { metadata },
        })
      : await getStripe().checkout.sessions.create({
          ...common,
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: PACKS[product].amount,
                product_data: { name: `MedChrono AI — ${PACKS[product].label} (${PACKS[product].credits} credit${PACKS[product].credits > 1 ? "s" : ""})` },
              },
            },
          ],
          payment_intent_data: { metadata },
        });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createPortal(user: SessionUser, baseUrl: string): Promise<string> {
  const customer = await ensureCustomer(user);
  const s = await getStripe().billingPortal.sessions.create({ customer, return_url: `${baseUrl}/billing` });
  return s.url;
}

async function orgIdForCustomer(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): Promise<string | null> {
  const id = typeof customer === "string" ? customer : customer?.id;
  if (!id) return null;
  const { rows } = await (await db()).query("select id from orgs where stripe_customer_id = $1", [id]);
  return rows[0]?.id ?? null;
}

async function fulfillPack(s: Stripe.Checkout.Session): Promise<void> {
  const product = s.metadata?.product;
  const orgId = (await orgIdForCustomer(s.customer)) ?? s.metadata?.org_id ?? null;
  if (!orgId || !isProduct(product) || product === "firm") return;
  await addPurchasedCredits(orgId, PACKS[product].credits, `Purchased ${PACKS[product].label} (${s.id})`);
}

const ACTIVE = new Set(["active", "trialing", "past_due"]);

/**
 * Applies one verified Stripe event. Returns false if the event was already processed.
 * Credits are granted only from events Stripe signed, never from the redirect back to /billing.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<boolean> {
  const fresh = await (await db()).query("insert into stripe_events (id, type) values ($1, $2) on conflict do nothing", [event.id, event.type]);
  if (!fresh.rowCount) return false;
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        if (s.mode === "payment" && s.payment_status === "paid") await fulfillPack(s);
        if (s.mode === "subscription" && typeof s.subscription === "string") {
          const orgId = (await orgIdForCustomer(s.customer)) ?? s.metadata?.org_id;
          if (orgId) await (await db()).query("update orgs set stripe_subscription_id = $2, plan = 'firm' where id = $1", [orgId, s.subscription]);
        }
        break;
      }
      case "checkout.session.async_payment_succeeded": {
        const s = event.data.object;
        if (s.mode === "payment") await fulfillPack(s);
        break;
      }
      case "invoice.paid": {
        const inv = event.data.object;
        const sub = inv.parent?.subscription_details?.subscription;
        if (!sub) break;
        const orgId = await orgIdForCustomer(inv.customer);
        if (!orgId) break;
        const periodEnd = inv.lines.data[0]?.period?.end ?? inv.period_end;
        await (await db()).query("update orgs set stripe_subscription_id = $2 where id = $1", [orgId, typeof sub === "string" ? sub : sub.id]);
        await renewPlanCredits(orgId, periodEnd ? new Date(periodEnd * 1000) : null, `Firm plan renewal (${inv.id})`);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const orgId = await orgIdForCustomer(sub.customer);
        if (!orgId) break;
        const active = event.type === "customer.subscription.updated" && ACTIVE.has(sub.status);
        const periodEnd = sub.items.data[0]?.current_period_end;
        await tx(async (c) => {
          await c.query(
            `update orgs set subscription_status = $2, plan = $3,
                    plan_credits = case when $3 = 'free' then 0 else plan_credits end,
                    current_period_end = $4
              where id = $1 and (stripe_subscription_id is null or stripe_subscription_id = $5)`,
            [orgId, sub.status, active ? "firm" : "free", periodEnd ? new Date(periodEnd * 1000) : null, sub.id],
          );
        });
        break;
      }
    }
    return true;
  } catch (e) {
    // Let Stripe retry: forget that we saw this event.
    await (await db()).query("delete from stripe_events where id = $1", [event.id]);
    throw e;
  }
}
