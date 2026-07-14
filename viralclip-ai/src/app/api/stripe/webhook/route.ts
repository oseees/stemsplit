import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { tierForPriceId } from "@/lib/plans";
import type { SubscriptionStatus } from "@/types/database";

// Stripe webhook: keeps the `subscriptions` table in sync.
// Uses the service-role client (bypasses RLS). Configure the endpoint secret
// as STRIPE_WEBHOOK_SECRET. Disable body parsing implicitly via raw text read.
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "no signature" }, { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "bad signature";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const admin = createAdminClient();

  async function syncSubscription(sub: Stripe.Subscription) {
    const userId =
      (sub.metadata?.user_id as string | undefined) ??
      ((await stripe.customers.retrieve(sub.customer as string)) as Stripe.Customer)
        .metadata?.user_id;
    if (!userId) return;

    const priceId = sub.items.data[0]?.price.id;
    const tier = sub.status === "active" || sub.status === "trialing"
      ? tierForPriceId(priceId)
      : "free";

    await admin
      .from("subscriptions")
      .update({
        tier,
        status: sub.status as SubscriptionStatus,
        stripe_customer_id: sub.customer as string,
        stripe_subscription_id: sub.id,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        cancel_at_period_end: sub.cancel_at_period_end,
      })
      .eq("user_id", userId);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(
          session.subscription as string,
        );
        await syncSubscription(sub);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
