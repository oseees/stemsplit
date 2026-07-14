import { withAuth, ok, fail } from "@/lib/api";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Creates a Stripe Checkout session for a Pro/Agency subscription.
export const POST = withAuth(async (req, ctx) => {
  const { priceId } = await req.json();
  if (!priceId) return fail("priceId required");

  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", ctx.userId)
    .single();

  let customerId = sub?.stripe_customer_id ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: ctx.email ?? undefined,
      metadata: { user_id: ctx.userId },
    });
    customerId = customer.id;
    await supabase
      .from("subscriptions")
      .update({ stripe_customer_id: customerId })
      .eq("user_id", ctx.userId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${SITE}/dashboard/billing?status=success`,
    cancel_url: `${SITE}/dashboard/billing?status=cancel`,
    metadata: { user_id: ctx.userId },
    subscription_data: { metadata: { user_id: ctx.userId } },
  });

  return ok({ url: session.url });
});
