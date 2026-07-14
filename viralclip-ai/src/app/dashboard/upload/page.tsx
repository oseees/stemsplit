"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, Youtube } from "lucide-react";
import { useUploadThing } from "@/lib/uploadthing";
import { fmtBytes } from "@/lib/utils";

type Stage =
  | "idle"
  | "uploading"
  | "downloading"
  | "processing"
  | "transcribing"
  | "analyzing"
  | "done"
  | "error";

const ACCEPT = ".mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo";

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  // Uploads bytes straight to UploadThing (no Supabase size cap). Progress is
  // mapped into the 20–70 band of our own bar.
  const { startUpload } = useUploadThing("videoUploader", {
    onUploadProgress: (p) => setProgress(20 + Math.round(p * 0.5)),
  });

  // Read duration in the browser so we don't need server-side ffprobe.
  function readMeta(f: File): Promise<{ durationSec: number; width: number; height: number; fps: number }> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(f);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve({
          durationSec: v.duration || 0,
          width: v.videoWidth,
          height: v.videoHeight,
          fps: 30,
        });
      };
      v.onerror = () => resolve({ durationSec: 0, width: 0, height: 0, fps: 30 });
      v.src = url;
    });
  }

  async function handleUpload(f: File) {
    setError(null);
    setFile(f);
    setStage("uploading");
    setProgress(5);

    try {
      const meta = await readMeta(f);
      setProgress(15);

      // 1. Upload bytes directly to UploadThing.
      const res = await startUpload([f]);
      const sourceUrl = res?.[0]?.ufsUrl;
      if (!sourceUrl) throw new Error("Upload failed");
      setProgress(80);

      // 2. Register the upload row with the resulting URL + probed metadata.
      setStage("processing");
      const completeRes = await fetch("/api/uploads/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl,
          filename: f.name,
          mimeType: f.type,
          sizeBytes: f.size,
          clientMeta: meta,
        }),
      });
      const data = await completeRes.json();
      if (!completeRes.ok) throw new Error(data.error);

      // Redirect straight to the clips page, which runs the AI analysis with a
      // live progress UI instead of blocking this screen.
      setProgress(100);
      setStage("done");
      router.push(`/dashboard/clips?uploadId=${data.uploadId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setStage("error");
    }
  }

  async function handleYouTube() {
    const link = url.trim();
    if (!link) return;
    setError(null);
    setFile(null);
    setStage("downloading");
    setProgress(15);

    try {
      const res = await fetch("/api/uploads/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Source is in + transcribed; the clips page handles analysis.
      setProgress(100);
      setStage("done");
      router.push(`/dashboard/clips?uploadId=${data.uploadId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setStage("error");
    }
  }

  const busy =
    stage === "uploading" || stage === "downloading" || stage === "processing";

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <h1 className="text-2xl font-semibold tracking-tight">Upload a video</h1>
      <p className="mt-1 text-sm text-white/50">
        MP4, MOV or AVI. We'll detect your best moments and cut shorts automatically.
      </p>

      <div
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy && e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
        }}
        className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-bg-border bg-bg-card/50 p-12 text-center transition hover:border-brand"
      >
        <UploadCloud className="text-brand" size={36} />
        <p className="mt-3 font-medium">Click or drag a video here</p>
        <p className="mt-1 text-xs text-white/40">Max ~2GB · vertical or horizontal</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
      </div>

      <div className="my-5 flex items-center gap-3 text-xs text-white/30">
        <span className="h-px flex-1 bg-bg-border" />
        OR
        <span className="h-px flex-1 bg-bg-border" />
      </div>

      <div className="rounded-xl border border-bg-border bg-bg-card/50 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Youtube className="text-red-500" size={18} />
          Paste a YouTube link
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            inputMode="url"
            value={url}
            disabled={busy}
            placeholder="https://www.youtube.com/watch?v=…"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && url.trim() && handleYouTube()}
            className="flex-1 rounded-lg border border-bg-border bg-bg/60 px-3 py-2 text-sm outline-none transition focus:border-brand disabled:opacity-50"
          />
          <button
            type="button"
            disabled={busy || !url.trim()}
            onClick={handleYouTube}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Make shorts
          </button>
        </div>
        <p className="mt-2 text-xs text-white/40">
          Only import videos you own or have the rights to. We turn them into
          original vertical clips — not for reposting others' content.
        </p>
      </div>

      {file && (
        <p className="mt-3 text-sm text-white/50">
          {file.name} · {fmtBytes(file.size)}
        </p>
      )}

      {busy && (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-bg-border">
            <div
              className="h-full bg-brand transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-white/50 capitalize">{stage}…</p>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
