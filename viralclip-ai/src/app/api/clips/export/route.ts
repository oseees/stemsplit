import { withAuth, ok, fail } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { getSourceBytes } from "@/lib/storage";
import { renderVerticalClip, renderThumbnail } from "@/lib/ffmpeg";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "uploads";

// Renders a clip to a vertical 9:16 mp4 + thumbnail and stores both.
// NOTE: requires ffmpeg on the host. On serverless, run this in a worker/queue
// instead — the interface is identical.
export const POST = withAuth(async (req, ctx) => {
  const { clipId } = await req.json();
  if (!clipId) return fail("clipId required");

  const supabase = await createClient();
  const { data: clip } = await supabase
    .from("clips")
    .select("*, uploads(storage_path, filename)")
    .eq("id", clipId)
    .eq("user_id", ctx.userId)
    .single();

  if (!clip) return fail("Clip not found", 404);
  const sourcePath = (clip as { uploads: { storage_path: string } }).uploads.storage_path;

  const dir = await mkdtemp(path.join(tmpdir(), "export-"));
  const inputPath = path.join(dir, "src.mp4");
  try {
    await writeFile(inputPath, await getSourceBytes(supabase, sourcePath));

    const [clipBuf, thumbBuf] = await Promise.all([
      renderVerticalClip({ inputPath, startSec: clip.start_sec, endSec: clip.end_sec }),
      renderThumbnail({ inputPath, atSec: clip.start_sec }),
    ]);

    const clipPath = `${ctx.userId}/${clip.upload_id}/clips/${clipId}.mp4`;
    const thumbPath = `${ctx.userId}/${clip.upload_id}/clips/${clipId}.jpg`;

    await supabase.storage.from(BUCKET).upload(clipPath, clipBuf, {
      contentType: "video/mp4",
      upsert: true,
    });
    await supabase.storage.from(BUCKET).upload(thumbPath, thumbBuf, {
      contentType: "image/jpeg",
      upsert: true,
    });

    await supabase
      .from("clips")
      .update({ storage_path: clipPath, thumbnail_path: thumbPath, exported: true })
      .eq("id", clipId);

    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(clipPath, 3600);

    return ok({ clipPath, thumbPath, downloadUrl: signed?.signedUrl });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
