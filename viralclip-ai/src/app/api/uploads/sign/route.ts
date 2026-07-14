import { withAuth, ok, fail } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { checkUploadQuota } from "@/lib/usage";

const ALLOWED = ["video/mp4", "video/quicktime", "video/x-msvideo"];
const BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "uploads";

// Creates an `uploads` row + a signed URL the client uploads the file to directly.
export const POST = withAuth(async (req, ctx) => {
  const { filename, mimeType, sizeBytes } = await req.json();

  if (!filename || !ALLOWED.includes(mimeType)) {
    return fail("Unsupported file type. Use MP4, MOV, or AVI.");
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
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes ?? null,
      storage_path: "", // filled below
      status: "uploading",
    })
    .select()
    .single();

  if (error || !upload) return fail(error?.message ?? "Could not create upload");

  const storagePath = `${ctx.userId}/${upload.id}/${filename}`;
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signErr || !signed) return fail(signErr?.message ?? "Could not sign upload");

  await supabase.from("uploads").update({ storage_path: storagePath }).eq("id", upload.id);

  return ok({
    uploadId: upload.id,
    bucket: BUCKET,
    path: storagePath,
    token: signed.token,
    signedUrl: signed.signedUrl,
  });
});
