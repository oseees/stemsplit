import type { SessionContext } from "@/lib/auth";

// Demo mode lets you explore the full UI without a Supabase backend.
// Enable by setting DEMO_MODE=true in .env. Never enable in production.
export const DEMO_MODE = process.env.DEMO_MODE === "true";

// A fake signed-in session on the Agency tier, so every feature gate is open.
export function demoSession(): SessionContext {
  const now = new Date().toISOString();
  return {
    userId: "00000000-0000-0000-0000-000000000000",
    email: "demo@viralclip.ai",
    profile: {
      id: "00000000-0000-0000-0000-000000000000",
      email: "demo@viralclip.ai",
      full_name: "Demo Creator",
      avatar_url: null,
      niche: "general",
      created_at: now,
      updated_at: now,
    },
    subscription: {
      id: "demo-sub",
      user_id: "00000000-0000-0000-0000-000000000000",
      tier: "agency",
      status: "active",
      stripe_customer_id: null,
      stripe_subscription_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
      created_at: now,
      updated_at: now,
    },
  };
}
