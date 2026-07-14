import { createClient } from "@/lib/supabase/server";
import { planFor } from "@/lib/plans";
import type { PlanTier, UsageTracking } from "@/types/database";

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export async function getUsage(userId: string): Promise<UsageTracking | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("usage_tracking")
    .select("*")
    .eq("user_id", userId)
    .eq("period", currentPeriod())
    .maybeSingle();
  return data as UsageTracking | null;
}

// Returns { allowed, used, limit }. Enforced before accepting a new upload.
export async function checkUploadQuota(
  userId: string,
  tier: PlanTier,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = planFor(tier).uploadsPerMonth;
  const usage = await getUsage(userId);
  const used = usage?.uploads ?? 0;
  return {
    allowed: used < limit,
    used,
    limit: limit === Infinity ? Number.POSITIVE_INFINITY : limit,
  };
}

// Atomic increment via the SQL function. Safe under concurrency.
export async function recordUsage(
  userId: string,
  delta: { uploads?: number; clips?: number; aiCalls?: number },
): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("increment_usage", {
    p_user_id: userId,
    p_uploads: delta.uploads ?? 0,
    p_clips: delta.clips ?? 0,
    p_ai_calls: delta.aiCalls ?? 0,
  });
}
