import { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;

const BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "uploads";

// Reads a source video's bytes regardless of where it lives: UploadThing files
// are stored as an https URL (fetched directly), while older uploads use a
// Supabase Storage path (downloaded from the bucket).
export async function getSourceBytes(
  supabase: Supa,
  storagePath: string,
): Promise<Buffer> {
  if (/^https?:\/\//.test(storagePath)) {
    const res = await fetch(storagePath);
    if (!res.ok) throw new Error(`Could not fetch source video (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) throw new Error("Could not read source video");
  return Buffer.from(await data.arrayBuffer());
}
