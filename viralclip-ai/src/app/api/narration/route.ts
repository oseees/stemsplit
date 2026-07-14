import { withAuth, ok, fail } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { generateNarration } from "@/lib/ai/narration";
import { recordUsage } from "@/lib/usage";
import type { NarrationMode } from "@/types/database";

const MODES: NarrationMode[] = [
  "storytelling",
  "documentary",
  "educational",
  "motivational",
  "news",
];

export const POST = withAuth(
  async (req, ctx) => {
    const { clipId, uploadId, mode, transcript, durationSec } = await req.json();
    if (!MODES.includes(mode)) return fail("Invalid narration mode");

    const script = await generateNarration({
      mode,
      transcript: transcript || "(clip)",
      durationSec: durationSec ?? 30,
      niche: ctx.profile?.niche,
    });

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("narrations")
      .insert({
        user_id: ctx.userId,
        clip_id: clipId ?? null,
        upload_id: uploadId ?? null,
        mode,
        script,
      })
      .select()
      .single();
    if (error) return fail(error.message);

    await recordUsage(ctx.userId, { aiCalls: 1 });
    return ok({ narration: data });
  },
  { feature: "aiNarration" },
);
