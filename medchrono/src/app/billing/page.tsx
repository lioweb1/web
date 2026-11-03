import { Check } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { BuyButton, PortalButton } from "@/components/billing-actions";
import { requireUser } from "@/lib/session";
import { recentUsage } from "@/lib/credits";
import { stripeConfigured } from "@/lib/billing";
import { FIRM_PLAN, PACKS, PAGES_PER_CREDIT, TRIAL_MAX_PAGES, usdCents, type PackId } from "@/lib/plans";

export const metadata = { title: "Billing — MedChrono AI" };

const KIND: Record<string, string> = { analysis: "Case analyzed", purchase: "Credits purchased", plan_renewal: "Monthly credits", refund: "Refund", adjustment: "Adjustment" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const u = await requireUser("/billing");
  const { status } = await searchParams;
  const usage = await recentUsage(u.org.id);
  const o = u.org;
  const onFirm = o.plan === "firm" && o.subscription_status !== "canceled";
  const payments = stripeConfigured() && u.role === "owner";
  const memberNote = u.role !== "owner";

  return (
    <div className="min-h-screen">
      <AppHeader current="billing" />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-serif text-3xl font-bold">Billing</h1>
        <p className="mt-1 text-muted">{o.name} · 1 credit = 1 case of up to {PAGES_PER_CREDIT.toLocaleString()} pages</p>

        {status === "success" && (
          <div className="mt-6 rounded-xl bg-teal-soft p-4 text-sm text-teal">
            Payment received — thank you. Credits appear here as soon as Stripe confirms the payment (usually a few seconds; refresh if needed).
          </div>
        )}
        {status === "cancelled" && <div className="mt-6 rounded-xl bg-paper p-4 text-sm text-muted">Checkout cancelled. You were not charged.</div>}
        {memberNote && <div className="mt-6 rounded-xl bg-paper p-4 text-sm text-muted">Only account owners can buy credits or change the plan. Ask an owner on your team.</div>}
        {!memberNote && !stripeConfigured() && <div className="mt-6 rounded-xl bg-warn-soft p-4 text-sm text-warn">Payments are not configured on this server yet (STRIPE_SECRET_KEY).</div>}

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            ["Free trial", o.trial_credits ? `1 case ≤ ${TRIAL_MAX_PAGES} pp.` : "Used", ""],
            ["Monthly plan credits", String(o.plan_credits), onFirm && o.current_period_end ? `Reset ${new Date(o.current_period_end).toLocaleDateString("en-US")}` : onFirm ? "Firm plan" : "No subscription"],
            ["Purchased credits", String(o.purchased_credits), "Never expire"],
          ].map(([k, v, sub]) => (
            <div key={k} className="rounded-2xl border border-line bg-white p-5">
              <div className="text-sm text-muted">{k}</div>
              <div className="mt-1 font-serif text-3xl font-bold">{v}</div>
              {sub && <div className="text-xs text-muted">{sub}</div>}
            </div>
          ))}
        </section>

        <section className="mt-10 grid gap-6 md:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-teal p-6 ring-1 ring-teal">
            <div className="text-sm font-semibold text-teal">Firm plan</div>
            <div className="mt-1 font-serif text-4xl font-bold">{usdCents(FIRM_PLAN.amount)}<span className="text-base font-normal text-muted"> / month</span></div>
            <ul className="mt-4 space-y-2 text-sm">
              {[`${FIRM_PLAN.credits} case credits every month`, "Firm letterhead on records requests", "Cancel anytime from the billing portal", "Extra cases with credit packs"].map((t) => (
                <li key={t} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 text-teal" /> {t}</li>
              ))}
            </ul>
            <div className="mt-6">
              {onFirm ? (
                <div className="space-y-3">
                  <div className="text-sm">You&apos;re on the Firm plan{o.subscription_status && o.subscription_status !== "active" ? ` (status: ${o.subscription_status})` : ""}.</div>
                  {payments && <PortalButton />}
                </div>
              ) : (
                payments && <BuyButton product="firm" primary>Subscribe — {usdCents(FIRM_PLAN.amount)}/mo</BuyButton>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-white p-6">
            <div className="text-sm font-semibold">Case credit packs</div>
            <p className="mt-1 text-sm text-muted">Pay as you go. Credits never expire.</p>
            <div className="mt-4 space-y-3">
              {(Object.keys(PACKS) as PackId[]).map((id) => {
                const p = PACKS[id];
                return (
                  <div key={id} className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{p.label}</div>
                      <div className="text-xs text-muted">{usdCents(Math.round(p.amount / p.credits))} per case</div>
                    </div>
                    <div className="w-36">{payments && <BuyButton product={id}>{usdCents(p.amount)}</BuyButton>}</div>
                  </div>
                );
              })}
            </div>
            {o.stripe_customer_id && !onFirm && payments && <div className="mt-5"><PortalButton /></div>}
          </div>
        </section>

        <section className="mt-10 overflow-x-auto rounded-2xl border border-line bg-white">
          <h2 className="border-b border-line p-4 font-semibold">Usage history</h2>
          <table className="w-full text-sm">
            <thead className="bg-paper text-left text-xs uppercase text-muted">
              <tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Activity</th><th className="px-4 py-2">By</th><th className="px-4 py-2">Pages</th><th className="px-4 py-2 text-right">Credits</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {usage.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 text-muted">{new Date(e.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="px-4 py-2">
                    {KIND[e.kind] ?? e.kind}
                    {e.status === "refunded" && <span className="ml-2 rounded bg-paper px-1.5 text-xs text-muted">refunded</span>}
                    {e.status === "running" && <span className="ml-2 rounded bg-warn-soft px-1.5 text-xs text-warn">processing</span>}
                    {e.note && e.kind !== "analysis" && <div className="text-xs text-muted">{e.note}</div>}
                  </td>
                  <td className="px-4 py-2 text-muted">{e.user_name ?? "—"}</td>
                  <td className="px-4 py-2">{e.pages?.toLocaleString() ?? ""}</td>
                  <td className={`px-4 py-2 text-right font-medium ${e.credits < 0 && e.status !== "refunded" ? "" : "text-teal"}`}>{e.credits > 0 ? `+${e.credits}` : e.credits === 0 ? "" : e.status === "refunded" ? "0" : e.credits}</td>
                </tr>
              ))}
              {usage.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No activity yet.</td></tr>}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-3 text-xs text-muted">For privacy, usage history records page counts only — never case names, patient names or file names.</p>
        </section>
      </main>
    </div>
  );
}
