import { withAuth, ok, fail } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { synthesizeSpeech } from "@/lib/ai/narration";
import { recordUsage } from "@/lib/usage";

const BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "uploads";

// Optional: render a narration script to speech (mp3) and store it.
export const POST = withAuth(
  async (req, ctx) => {
    const { narrationId } = await req.json();
    if (!narrationId) return fail("narrationId required");

    const supabase = await createClient();
    const { data: narration } = await supabase
      .from("narrations")
      .select("*")
      .eq("id", narrationId)
      .eq("user_id", ctx.userId)
      .single();
    if (!narration) return fail("Narration not found", 404);

    const audio = await synthesizeSpeech(narration.script);
    const audioPath = `${ctx.userId}/narrations/${narrationId}.mp3`;

    await supabase.storage.from(BUCKET).upload(audioPath, audio, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    await supabase.from("narrations").update({ audio_path: audioPath }).eq("id", narrationId);

    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(audioPath, 3600);

    await recordUsage(ctx.userId, { aiCalls: 1 });
    return ok({ audioPath, url: signed?.signedUrl });
  },
  { feature: "aiNarration" },
);
