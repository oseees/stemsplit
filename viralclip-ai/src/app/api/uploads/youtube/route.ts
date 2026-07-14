import { withAuth, ok, fail } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { checkUploadQuota, recordUsage } from "@/lib/usage";
import { probe } from "@/lib/ffmpeg";
import { transcribeFile, type TranscriptSegment } from "@/lib/ai/transcribe";
import { downloadYouTube, isYouTubeUrl } from "@/lib/youtube";
import { UTApi } from "uploadthing/server";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Downloading + remuxing a full video can take a while.
export const maxDuration = 300;

// Imports a YouTube video by URL: downloads it with yt-dlp, probes metadata,
// stores it in the same bucket as a normal upload, and returns an uploadId the
// client can feed straight into /api/transcribe + /api/analyze.
export const POST = withAuth(async (req, ctx) => {
  const { url } = await req.json();
  if (!url || typeof url !== "string" || !isYouTubeUrl(url)) {
    return fail("Enter a valid YouTube video URL.");
  }

  const quota = await checkUploadQuota(ctx.userId, ctx.subscription?.tier ?? "free");
  if (!quota.allowed) {
    return fail(`Monthly upload limit reached (${quota.limit}). Upgrade to continue.`, 402);
  }

  const supabase = await createClient();
  const { data: upload, error } = await supabase
    .from("uploads")
    .insert({
      user_id: ctx.userId,
      filename: "youtube.mp4",
      mime_type: "video/mp4",
      storage_path: "",
      status: "uploading",
    })
    .select()
    .single();

  if (error || !upload) return fail(error?.message ?? "Could not create upload");

  const dir = await mkdtemp(path.join(tmpdir(), "yt-"));
  try {
    const dl = await downloadYouTube(url, dir);
    const meta = await probe(dl.filePath);
    const bytes = await readFile(dl.filePath);

    // Overlap the two slowest steps: push the file to UploadThing AND transcribe
    // the local copy at the same time, instead of running them back-to-back.
    const [uploaded, transcript] = await Promise.all([
      new UTApi().uploadFiles(
        new File([bytes], dl.filename, { type: "video/mp4" }),
      ),
      transcribeFile(dl.filePath, meta.durationSec).catch(
        () => [] as TranscriptSegment[],
      ),
    ]);
    if (uploaded.error) throw new Error(uploaded.error.message);

    await supabase
      .from("uploads")
      .update({
        filename: dl.filename,
        storage_path: uploaded.data.ufsUrl,
        size_bytes: bytes.length,
        status: "uploaded",
        duration_sec: meta.durationSec,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
        transcript,
      })
      .eq("id", upload.id);

    await recordUsage(ctx.userId, { uploads: 1, aiCalls: transcript.length ? 1 : 0 });

    return ok({ uploadId: upload.id, meta, title: dl.title });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Download failed";
    const msg = /max-filesize|maximum allowed size|larger than|file size limit/i.test(raw)
      ? "This video is too large to import. Try a shorter video."
      : raw;
    await supabase
      .from("uploads")
      .update({ status: "failed", error: msg })
      .eq("id", upload.id);
    return fail(msg, 502);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
