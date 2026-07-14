import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { hasFeature } from "@/lib/plans";
import { fmtDuration } from "@/lib/utils";
import { ClipStudio } from "@/components/dashboard/clip-studio";
import { ClipProcessor } from "@/components/dashboard/clip-processor";
import type { Analysis, Clip, Upload } from "@/types/database";

export default async function ClipsPage({
  searchParams,
}: {
  searchParams: Promise<{ uploadId?: string }>;
}) {
  const { userId, subscription } = await requireUser();
  const { uploadId } = await searchParams;
  const supabase = await createClient();

  // No upload selected → show the upload picker.
  if (!uploadId) {
    const { data } = await supabase
      .from("uploads")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    const uploads = (data ?? []) as Upload[];

    return (
      <div className="mx-auto max-w-4xl animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight">Your videos</h1>
        {uploads.length === 0 ? (
          <p className="mt-4 text-sm text-white/50">
            No uploads yet.{" "}
            <Link href="/dashboard/upload" className="text-brand">Upload one →</Link>
          </p>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {uploads.map((u) => (
              <Link
                key={u.id}
                href={`/dashboard/clips?uploadId=${u.id}`}
                className="card p-4 transition hover:border-brand"
              >
                <p className="truncate font-medium">{u.filename}</p>
                <p className="mt-1 text-xs text-white/40">
                  {fmtDuration(u.duration_sec)} · {u.status}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  const [{ data: clipData }, { data: analysisData }, { data: upload }] = await Promise.all([
    supabase.from("clips").select("*").eq("upload_id", uploadId).eq("user_id", userId).order("length"),
    supabase.from("analysis").select("*").eq("upload_id", uploadId).eq("user_id", userId).maybeSingle(),
    supabase.from("uploads").select("*").eq("id", uploadId).eq("user_id", userId).single(),
  ]);

  const up = upload as Upload | null;
  const transcript = (up as { transcript?: unknown[] } | null)?.transcript;
  const needsProcessing = !!up && up.status !== "analyzed" && !analysisData;

  return (
    <div className="mx-auto max-w-4xl animate-fade-up">
      <Link href="/dashboard/clips" className="text-sm text-white/40 hover:text-white">
        ← All videos
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {up?.filename ?? "Clips"}
      </h1>
      {analysisData && (
        <p className="mt-1 text-sm text-white/50">{(analysisData as Analysis).summary}</p>
      )}

      {needsProcessing && (
        <div className="mt-6">
          <ClipProcessor
            uploadId={uploadId}
            needsTranscript={!Array.isArray(transcript) || transcript.length === 0}
          />
        </div>
      )}

      <div className="mt-6">
        <ClipStudio
          clips={(clipData ?? []) as Clip[]}
          analysis={(analysisData ?? null) as Analysis | null}
          canIntel={hasFeature(subscription?.tier, "viralIntelligence")}
          canNarrate={hasFeature(subscription?.tier, "aiNarration")}
        />
      </div>
    </div>
  );
}
