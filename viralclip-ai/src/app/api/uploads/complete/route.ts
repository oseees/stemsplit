import { withAuth, ok, fail } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { recordUsage } from "@/lib/usage";
import { probe } from "@/lib/ffmpeg";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "uploads";

// Called after the client finishes uploading. Probes metadata via ffprobe and
// marks the upload ready. Client may also pass clientMeta to skip the download
// (useful in serverless where ffprobe is unavailable).
export const POST = withAuth(async (req, ctx) => {
  const { uploadId, clientMeta } = await req.json();
  if (!uploadId) return fail("uploadId required");

  const supabase = await createClient();
  const { data: upload } = await supabase
    .from("uploads")
    .select("*")
    .eq("id", uploadId)
    .eq("user_id", ctx.userId)
    .single();

  if (!upload) return fail("Upload not found", 404);

  let meta = clientMeta as
    | { durationSec: number; width: number; height: number; fps: number }
    | undefined;

  if (!meta) {
    // Download to tmp and probe server-side.
    const { data: blob, error } = await supabase.storage
      .from(BUCKET)
      .download(upload.storage_path);
    if (error || !blob) return fail("Could not read uploaded file");

    const dir = await mkdtemp(path.join(tmpdir(), "probe-"));
    const local = path.join(dir, upload.filename);
    try {
      await writeFile(local, Buffer.from(await blob.arrayBuffer()));
      meta = await probe(local);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  await supabase
    .from("uploads")
    .update({
      status: "uploaded",
      duration_sec: meta.durationSec,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
    })
    .eq("id", uploadId);

  await recordUsage(ctx.userId, { uploads: 1 });

  return ok({ uploadId, meta });
});
