import { withAuth, ok, fail } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

// GET /api/clips?uploadId=... — list clips for an upload.
export const GET = withAuth(async (req, ctx) => {
  const uploadId = new URL(req.url).searchParams.get("uploadId");
  const supabase = await createClient();
  let query = supabase.from("clips").select("*").eq("user_id", ctx.userId);
  if (uploadId) query = query.eq("upload_id", uploadId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return fail(error.message);
  return ok({ clips: data });
});

// PATCH /api/clips — manual adjustment of start/end/title.
export const PATCH = withAuth(async (req, ctx) => {
  const { id, startSec, endSec, title } = await req.json();
  if (!id) return fail("clip id required");
  if (startSec != null && endSec != null && endSec <= startSec) {
    return fail("endSec must be greater than startSec");
  }

  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  if (startSec != null) patch.start_sec = startSec;
  if (endSec != null) patch.end_sec = endSec;
  if (title != null) patch.title = title;

  const { data, error } = await supabase
    .from("clips")
    .update(patch)
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .select()
    .single();

  if (error) return fail(error.message);
  return ok({ clip: data });
});
