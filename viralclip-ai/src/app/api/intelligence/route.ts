import { withAuth, ok, fail } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { generateIntelligence } from "@/lib/ai/intelligence";
import { recordUsage } from "@/lib/usage";

// Generates the full viral intelligence pack for a clip and stores its scores.
// Gated to plans that include viralIntelligence.
export const POST = withAuth(
  async (req, ctx) => {
    const { clipId, transcript } = await req.json();
    if (!clipId) return fail("clipId required");

    const supabase = await createClient();
    const { data: clip } = await supabase
      .from("clips")
      .select("*")
      .eq("id", clipId)
      .eq("user_id", ctx.userId)
      .single();
    if (!clip) return fail("Clip not found", 404);

    const pack = await generateIntelligence({
      transcript: transcript || clip.title || "(clip)",
      durationSec: clip.end_sec - clip.start_sec,
      niche: ctx.profile?.niche,
    });

    await supabase.from("viral_scores").upsert(
      {
        clip_id: clipId,
        user_id: ctx.userId,
        virality: pack.scores.virality,
        retention: pack.scores.retention,
        engagement: pack.scores.engagement,
        reasons: pack.scores.reasons,
        improvements: pack.scores.improvements,
      },
      { onConflict: "clip_id" },
    );

    await recordUsage(ctx.userId, { aiCalls: 1 });
    return ok(pack);
  },
  { feature: "viralIntelligence" },
);
