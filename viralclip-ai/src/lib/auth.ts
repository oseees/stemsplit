import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Subscription } from "@/types/database";

export interface SessionContext {
  userId: string;
  email: string | null;
  profile: Profile | null;
  subscription: Subscription | null;
}

// Throws via redirect when there is no authenticated user. Use in dashboard pages.
export async function requireUser(): Promise<SessionContext> {
  // Demo mode: skip Supabase auth entirely.
  const { DEMO_MODE, demoSession } = await import("@/lib/demo");
  if (DEMO_MODE) return demoSession();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: profile }, { data: subscription }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("subscriptions").select("*").eq("user_id", user.id).single(),
  ]);

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: profile as Profile | null,
    subscription: subscription as Subscription | null,
  };
}

// Non-redirecting variant for API routes. Returns null when unauthenticated.
export async function getUser(): Promise<SessionContext | null> {
  const { DEMO_MODE, demoSession } = await import("@/lib/demo");
  if (DEMO_MODE) return demoSession();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: null,
    subscription: subscription as Subscription | null,
  };
}
