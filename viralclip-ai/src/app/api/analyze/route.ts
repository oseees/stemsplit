import { withAuth, ok, fail } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { analyzeVideo, detectClips } from "@/lib/ai/analysis";
import { AI_MODEL } from "@/lib/ai/client";
import { recordUsage } from "@/lib/usage";

// Runs AI analysis on an uploaded video and persists moments + retention + clips.
// `transcript` should come from a speech-to-text step on the client/worker.
export const POST = withAuth(async (req, ctx) => {
  const { uploadId, transcript } = await req.json();
  if (!uploadId) return fail("uploadId required");

  const supabase = await createClient();
  const { data: upload } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", uploadId)
    .eq("user_id", ctx.userId)
    .single();

  if (!upload) return fail("Upload not found", 404);
  if (!upload.duration_sec) return fail("Upload not processed yet");

  await supabase.from("uploads").update({ status: "processing" }).eq("id", uploadId);

  // Prefer a transcript passed in the request, then the one stored by
  // /api/transcribe, then a single placeholder block as a last resort.
  const storedTranscript = Array.isArray(upload.transcript) ? upload.transcript : [];
  const segments =
    Array.isArray(transcript) && transcript.length
      ? transcript
      : storedTranscript.length
        ? storedTranscript
        : [{ start: 0, end: upload.duration_sec, text: "(no transcript provided)" }];

  const result = await analyzeVideo({
    durationSec: upload.duration_sec,
    transcript: segments,
    niche: ctx.profile?.niche,
  });

  // Persist analysis (upsert on upload_id).
  await supabase.from("analysis").upsert(
    {
      upload_id: uploadId,
      user_id: ctx.userId,
      moments: result.moments,
      retention: result.retention,
      summary: result.summary,
      model: AI_MODEL,
    },
    { onConflict: "upload_id" },
  );

  // Detect clip windows and insert (replace any existing for this upload).
  const detected = detectClips(result.moments, upload.duration_sec);
  await supabase.from("clips").delete().eq("upload_id", uploadId);
  const { data: clips } = await supabase
    .from("clips")
    .insert(
      detected.map((c) => ({
        upload_id: uploadId,
        user_id: ctx.userId,
        length: c.length,
        start_sec: c.start,
        end_sec: c.end,
        title: c.anchorReason.slice(0, 80),
      })),
    )
    .select();

  await supabase.from("uploads").update({ status: "analyzed" }).eq("id", uploadId);
  await recordUsage(ctx.userId, { aiCalls: 1, clips: clips?.length ?? 0 });

  return ok({
    moments: result.moments,
    retention: result.retention,
    summary: result.summary,
    clips,
  });
});
