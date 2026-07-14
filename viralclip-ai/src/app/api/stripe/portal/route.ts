import { withAuth, ok, fail } from "@/lib/api";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Opens the Stripe billing portal so the user can manage/cancel their plan.
export const POST = withAuth(async (_req, ctx) => {
  const supabase = await createClient();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", ctx.userId)
    .single();

  if (!sub?.stripe_customer_id) return fail("No billing account yet");

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${SITE}/dashboard/billing`,
  });
  return ok({ url: session.url });
});
