import { withAuth, ok, fail } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { getSourceBytes } from "@/lib/storage";
import { transcribeFile } from "@/lib/ai/transcribe";
import { recordUsage } from "@/lib/usage";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Long videos take a while — allow up to 5 minutes on platforms that honor this.
// For very long media, run this module from a dedicated queue worker instead.
export const maxDuration = 300;

// Downloads the uploaded file, extracts audio, transcribes it to timestamped
// segments, and stores them on the upload row for /api/analyze to consume.
export const POST = withAuth(async (req, ctx) => {
  const { uploadId } = await req.json();
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

  const dir = await mkdtemp(path.join(tmpdir(), "transcribe-"));
  const local = path.join(dir, upload.filename);
  try {
    await writeFile(local, await getSourceBytes(supabase, upload.storage_path));
    const segments = await transcribeFile(local, upload.duration_sec);

    await supabase.from("uploads").update({ transcript: segments }).eq("id", uploadId);
    await recordUsage(ctx.userId, { aiCalls: 1 });

    return ok({ uploadId, segments });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
