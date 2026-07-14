"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Runs transcription (if needed) + AI analysis for a freshly uploaded video,
// right on the clips page, then refreshes so the clips appear. This lets the
// upload screen redirect instantly instead of blocking on the whole pipeline.
export function ClipProcessor({
  uploadId,
  needsTranscript,
}: {
  uploadId: string;
  needsTranscript: boolean;
}) {
  const router = useRouter();
  const started = useRef(false);
  const [stage, setStage] = useState<"transcribing" | "analyzing" | "error">(
    needsTranscript ? "transcribing" : "analyzing",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        if (needsTranscript) {
          setStage("transcribing");
          try {
            await fetch("/api/transcribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ uploadId }),
            });
          } catch {
            // Non-fatal — analysis falls back to whatever transcript exists.
          }
        }

        setStage("analyzing");
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId }),
        });
        if (!res.ok) {
          throw new Error((await res.json()).error ?? "Analysis failed");
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Processing failed");
        setStage("error");
      }
    })();
  }, [uploadId, needsTranscript, router]);

  if (stage === "error") {
    return (
      <div className="card p-4 text-sm text-red-400">Processing failed: {error}</div>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        <p className="text-sm capitalize text-white/70">
          {stage}… finding your best moments
        </p>
      </div>
      <p className="mt-2 text-xs text-white/40">
        This can take up to a minute. The page updates automatically when done.
      </p>
    </div>
  );
}
