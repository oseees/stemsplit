import { requireUser } from "@/lib/auth";
import { PLANS, planFor } from "@/lib/plans";
import { UpgradeButton, ManageBillingButton } from "@/components/dashboard/billing-actions";

export default async function BillingPage() {
  const { subscription } = await requireUser();
  const current = planFor(subscription?.tier);

  return (
    <div className="mx-auto max-w-4xl animate-fade-up">
      <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
      <p className="mt-1 text-sm text-white/50">
        Current plan: <strong className="text-white">{current.name}</strong>
        {subscription?.current_period_end && current.tier !== "free" && (
          <> · renews {new Date(subscription.current_period_end).toLocaleDateString()}</>
        )}
      </p>

      {subscription?.stripe_customer_id && (
        <div className="mt-4">
          <ManageBillingButton />
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {Object.values(PLANS).map((p) => {
          const isCurrent = p.tier === current.tier;
          return (
            <div
              key={p.tier}
              className={`card p-6 ${p.tier === "pro" ? "ring-1 ring-brand" : ""}`}
            >
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-1 text-2xl font-bold">{p.price}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-white/60">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-accent">✓</span> {f}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {isCurrent ? (
                  <button className="btn-ghost w-full" disabled>
                    Current plan
                  </button>
                ) : p.tier === "free" ? (
                  <ManageBillingButton />
                ) : (
                  <UpgradeButton priceId={p.priceId} label={`Upgrade to ${p.name}`} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-white/40">
        All scores and analyses are predictions to guide your content — not guarantees of
        virality.
      </p>
    </div>
  );
}
