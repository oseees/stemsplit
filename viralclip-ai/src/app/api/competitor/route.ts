import { withAuth, ok, fail } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { analyzeCompetitor, detectPlatform } from "@/lib/ai/competitor";
import { recordUsage } from "@/lib/usage";

export const POST = withAuth(
  async (req, ctx) => {
    const { url, transcript } = await req.json();
    if (!url || !/^https?:\/\//.test(url)) return fail("Valid URL required");

    const analysis = await analyzeCompetitor({
      url,
      transcript,
      niche: ctx.profile?.niche,
    });

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("competitor_reports")
      .insert({
        user_id: ctx.userId,
        source_url: url,
        platform: analysis.platform ?? detectPlatform(url),
        hook_strength: analysis.hookStrength,
        editing_pace: analysis.editingPace,
        structure: analysis.structure,
        engagement_drivers: analysis.engagementDrivers,
        recommendations: analysis.recommendations,
        raw: analysis,
      })
      .select()
      .single();
    if (error) return fail(error.message);

    await recordUsage(ctx.userId, { aiCalls: 1 });
    return ok({ report: data });
  },
  { feature: "competitorAnalysis" },
);

export const GET = withAuth(async (_req, ctx) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("competitor_reports")
    .select("*")
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(20);
  return ok({ reports: data });
});
