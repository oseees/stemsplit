import { withAuth, ok, fail } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { checkUploadQuota, recordUsage } from "@/lib/usage";

const ALLOWED = ["video/mp4", "video/quicktime", "video/x-msvideo"];

// Registers an `uploads` row for a file the browser already pushed to
// UploadThing. Stores the resulting URL as storage_path plus the metadata the
// client probed, then marks it ready so the clips page can run the pipeline.
export const POST = withAuth(async (req, ctx) => {
  const { sourceUrl, filename, mimeType, sizeBytes, clientMeta } = await req.json();

  if (!sourceUrl || typeof sourceUrl !== "string" || !/^https?:\/\//.test(sourceUrl)) {
    return fail("Missing upload URL.");
  }
  if (!filename || !ALLOWED.includes(mimeType)) {
    return fail("Unsupported file type. Use MP4, MOV, or AVI.");
  }

  const quota = await checkUploadQuota(ctx.userId, ctx.subscription?.tier ?? "free");
  if (!quota.allowed) {
    return fail(`Monthly upload limit reached (${quota.limit}). Upgrade to continue.`, 402);
  }

  const meta = clientMeta as
    | { durationSec: number; width: number; height: number; fps: number }
    | undefined;

  const supabase = await createClient();
  const { data: upload, error } = await supabase
    .from("uploads")
    .insert({
      user_id: ctx.userId,
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes ?? null,
      storage_path: sourceUrl,
      status: "uploaded",
      duration_sec: meta?.durationSec ?? null,
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      fps: meta?.fps ?? null,
    })
    .select()
    .single();

  if (error || !upload) return fail(error?.message ?? "Could not create upload");

  await recordUsage(ctx.userId, { uploads: 1 });

  return ok({ uploadId: upload.id });
});
