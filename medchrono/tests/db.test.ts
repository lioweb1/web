import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";

// Integration tests against a real PostgreSQL. Run with TEST_DATABASE_URL set to a throwaway database.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("accounts, credits and Stripe webhooks (PostgreSQL)", async () => {
  process.env.DATABASE_URL = url;
  const { db, closeDb } = await import("@/lib/db");
  const auth = await import("@/lib/auth");
  const credits = await import("@/lib/credits");
  const billing = await import("@/lib/billing");

  const email = `owner+${Date.now()}@firm.test`;
  let orgId = "";
  let userId = "";
  let token = "";

  beforeAll(async () => {
    const c = await db();
    await c.query("truncate orgs, users, sessions, usage_events, stripe_events, login_attempts cascade");
  });
  afterAll(closeDb);

  it("signs up with a free trial credit and a working session", async () => {
    const s = await auth.signUp({ email, password: "correct horse battery", name: "Owner", firm: "Rivera Law" });
    token = s.token;
    const u = await auth.userFromToken(token);
    expect(u?.email).toBe(email);
    expect(u?.org).toMatchObject({ name: "Rivera Law", trial_credits: 1, plan_credits: 0, purchased_credits: 0, plan: "free" });
    orgId = u!.org.id;
    userId = u!.id;
  });

  it("rejects duplicate emails (case-insensitive) and weak passwords", async () => {
    await expect(auth.signUp({ email: email.toUpperCase(), password: "correct horse battery", name: "X", firm: "Y" })).rejects.toThrow(/already exists/);
    await expect(auth.signUp({ email: "a@b.co", password: "short", name: "X", firm: "Y" })).rejects.toThrow(/10 characters/);
  });

  it("logs in, rejects bad passwords and throttles brute force", async () => {
    await expect(auth.logIn(email, "correct horse battery", "1.1.1.1")).resolves.toHaveProperty("token");
    for (let i = 0; i < 8; i++) await expect(auth.logIn(email, "wrong password!", "2.2.2.2")).rejects.toThrow(/Incorrect/);
    await expect(auth.logIn(email, "correct horse battery", "2.2.2.2")).rejects.toThrow(/Too many attempts/);
  });

  it("stores only a hash of the session token and logs out", async () => {
    const s = await auth.createSession(userId);
    const { rows } = await (await db()).query("select token_hash from sessions where token_hash = $1", [s.token]);
    expect(rows).toHaveLength(0);
    await auth.deleteSession(s.token);
    expect(await auth.userFromToken(s.token)).toBeNull();
  });

  it("spends the trial, then requires payment", async () => {
    const r = await credits.reserveCredits(orgId, userId, 120, 1);
    expect(r.spend.trial).toBe(1);
    await credits.finishReservation(r.eventId);
    await expect(credits.reserveCredits(orgId, userId, 120, 1)).rejects.toMatchObject({ status: 402, code: "payment_required" });
  });

  it("refunds a failed case exactly once", async () => {
    await credits.addPurchasedCredits(orgId, 3, "test");
    const r = await credits.reserveCredits(orgId, userId, 1500, 2);
    expect(r.spend).toMatchObject({ purchased: 2, credits: 2 });
    await credits.refundReservation(r.eventId, "boom");
    await credits.refundReservation(r.eventId, "boom again");
    const u = await auth.userFromToken(token);
    expect(u!.org.purchased_credits).toBe(3);
  });

  it("never lets parallel uploads overspend", async () => {
    // 3 credits, 5 concurrent 1-credit cases: at most MAX_CONCURRENT (2) may start, and the balance never goes negative.
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => credits.reserveCredits(orgId, userId, 500, 1)));
    const ok = attempts.filter((a) => a.status === "fulfilled");
    expect(ok.length).toBe(2);
    const u = await auth.userFromToken(token);
    expect(u!.org.purchased_credits).toBe(1);
    for (const a of ok) await credits.finishReservation((a as PromiseFulfilledResult<{ eventId: number }>).value.eventId);
  });

  describe("Stripe webhooks", () => {
    const customer = "cus_test_123";
    const ev = (id: string, type: string, object: object) => ({ id, type, data: { object } }) as unknown as Stripe.Event;

    beforeAll(async () => {
      await (await db()).query("update orgs set stripe_customer_id = $2 where id = $1", [orgId, customer]);
    });

    it("grants a credit pack once per event, only when paid", async () => {
      const before = (await auth.userFromToken(token))!.org.purchased_credits;
      const session = { id: "cs_1", mode: "payment", payment_status: "paid", customer, metadata: { org_id: orgId, product: "case_5" } };
      expect(await billing.handleStripeEvent(ev("evt_1", "checkout.session.completed", session))).toBe(true);
      expect(await billing.handleStripeEvent(ev("evt_1", "checkout.session.completed", session))).toBe(false);
      await billing.handleStripeEvent(ev("evt_2", "checkout.session.completed", { ...session, id: "cs_2", payment_status: "unpaid" }));
      expect((await auth.userFromToken(token))!.org.purchased_credits).toBe(before + 5);
    });

    it("ignores tampered product metadata", async () => {
      const before = (await auth.userFromToken(token))!.org.purchased_credits;
      await billing.handleStripeEvent(ev("evt_3", "checkout.session.completed", { id: "cs_3", mode: "payment", payment_status: "paid", customer, metadata: { product: "case_9999" } }));
      expect((await auth.userFromToken(token))!.org.purchased_credits).toBe(before);
    });

    it("activates the Firm plan and resets monthly credits on each paid invoice", async () => {
      await billing.handleStripeEvent(ev("evt_4", "checkout.session.completed", { id: "cs_4", mode: "subscription", subscription: "sub_1", customer, metadata: { org_id: orgId, product: "firm" } }));
      const invoice = (id: string) => ({ id, customer, period_end: 1_900_000_000, parent: { subscription_details: { subscription: "sub_1" } }, lines: { data: [{ period: { end: 1_900_000_000 } }] } });
      await billing.handleStripeEvent(ev("evt_5", "invoice.paid", invoice("in_1")));
      let o = (await auth.userFromToken(token))!.org;
      expect(o).toMatchObject({ plan: "firm", subscription_status: "active", plan_credits: 25 });
      const r = await credits.reserveCredits(orgId, userId, 900, 1);
      expect(r.spend.plan).toBe(1);
      await credits.finishReservation(r.eventId);
      await billing.handleStripeEvent(ev("evt_6", "invoice.paid", invoice("in_2")));
      o = (await auth.userFromToken(token))!.org;
      expect(o.plan_credits).toBe(25); // reset, no rollover
    });

    it("drops monthly credits when the subscription ends but keeps purchased ones", async () => {
      const purchased = (await auth.userFromToken(token))!.org.purchased_credits;
      await billing.handleStripeEvent(ev("evt_7", "customer.subscription.deleted", { id: "sub_1", customer, status: "canceled", items: { data: [{ current_period_end: 1_900_000_000 }] } }));
      const o = (await auth.userFromToken(token))!.org;
      expect(o).toMatchObject({ plan: "free", plan_credits: 0, subscription_status: "canceled", purchased_credits: purchased });
    });

    it("verifies webhook signatures", () => {
      const stripe = new Stripe("sk_test_dummy");
      const payload = JSON.stringify({ id: "evt_sig", object: "event", type: "ping", data: { object: {} } });
      const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
      expect(stripe.webhooks.constructEvent(payload, header, "whsec_test").id).toBe("evt_sig");
      expect(() => stripe.webhooks.constructEvent(payload.replace("ping", "pong"), header, "whsec_test")).toThrow();
    });
  });
});
