"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, Music2, X, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { uploadAudio, startSeparation } from "@/lib/api";

type Stage = "idle" | "uploading" | "processing" | "separating" | "done" | "error";

const stageLabels: Record<Stage, string> = {
  idle: "",
  uploading: "Uploading your track...",
  processing: "Analysing audio...",
  separating: "Separating stems with AI...",
  done: "Done!",
  error: "Something went wrong",
};

const stageProgress: Record<Stage, number> = {
  idle: 0,
  uploading: 25,
  processing: 50,
  separating: 85,
  done: 100,
  error: 0,
};

const stemColors = ["from-purple-500 to-pink-500", "from-orange-500 to-red-500", "from-blue-500 to-cyan-500", "from-green-500 to-emerald-500"];
const stemLabels = ["Vocals", "Drums", "Bass", "Other"];

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [activeStem, setActiveStem] = useState(0);

  const handleFile = useCallback((f: File) => {
    if (!f.type.match(/audio\/(mpeg|wav|x-wav|mp3|flac|aac)/)) {
      setError("Please upload an MP3, WAV, FLAC, or AAC file.");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError("File must be under 50MB.");
      return;
    }
    setError("");
    setFile(f);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const startProcessing = async () => {
    if (!file) return;
    setError("");

    try {
      setStage("uploading");
      const { job_id } = await uploadAudio(file);

      setStage("separating");
      await startSeparation(job_id);

      // Redirect immediately — results page polls for completion
      router.push(`/results?id=${job_id}`);
    } catch (err) {
      setStage("error");
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  };

  const reset = () => {
    setFile(null);
    setStage("idle");
    setError("");
  };

  return (
    <div className="pt-16 min-h-screen flex items-center justify-center px-6">
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-purple-600/8 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-xl">
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            Upload Your <span className="gradient-text">Track</span>
          </h1>
          <p className="text-white/50">Supports MP3, WAV, FLAC, AAC — up to 50MB</p>
        </div>

        {stage === "idle" ? (
          <>
            {/* Drop zone */}
            <label
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`relative rounded-2xl border-2 border-dashed transition-all cursor-pointer p-12 text-center block ${
                dragging
                  ? "border-purple-400 bg-purple-500/10"
                  : file
                  ? "border-purple-500/50 bg-purple-900/10"
                  : "border-white/10 hover:border-white/20 hover:bg-white/5"
              }`}
            >
              <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={onInputChange} />

              {file ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
                    <Music2 size={28} className="text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-lg">{file.name}</p>
                    <p className="text-sm text-white/40">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); reset(); }}
                    className="absolute top-4 right-4 p-1 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-white/20 flex items-center justify-center">
                    <Upload size={24} className="text-white/40" />
                  </div>
                  <div>
                    <p className="font-semibold text-lg">Drop your audio here</p>
                    <p className="text-sm text-white/40 mt-1">or click to browse files</p>
                  </div>
                </div>
              )}
            </label>

            {error && (
              <div className="mt-4 flex items-center gap-2 text-red-400 text-sm glass-card rounded-xl px-4 py-3 border border-red-500/20">
                <AlertCircle size={16} className="shrink-0" />
                {error}
              </div>
            )}

            <button
              disabled={!file}
              onClick={startProcessing}
              className="mt-6 w-full py-4 rounded-xl font-semibold text-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 shadow-lg shadow-purple-500/20"
            >
              Separate Stems
            </button>
          </>
        ) : (
          /* Processing view */
          <div className="glass-card neon-border rounded-2xl p-10 text-center">
            {stage === "error" ? (
              <>
                <AlertCircle size={48} className="text-red-400 mx-auto mb-4" />
                <p className="font-semibold text-lg mb-2">Processing failed</p>
                <p className="text-sm text-white/50 mb-6">{error}</p>
                <button onClick={reset} className="px-6 py-3 rounded-xl glass-card border border-white/10 hover:border-white/20 transition-all">
                  Try again
                </button>
              </>
            ) : stage === "done" ? (
              <>
                <CheckCircle size={48} className="text-green-400 mx-auto mb-4" />
                <p className="font-semibold text-lg">Stems ready!</p>
                <p className="text-sm text-white/50 mt-2">Redirecting to results...</p>
              </>
            ) : (
              <>
                {/* Animated spinner ring */}
                <div className="relative w-24 h-24 mx-auto mb-8">
                  <div className="absolute inset-0 rounded-full border-4 border-white/5" />
                  <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-purple-500 animate-spin" />
                  <div className="absolute inset-2 rounded-full border-4 border-transparent border-t-blue-400 animate-spin" style={{ animationDuration: "1.5s", animationDirection: "reverse" }} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 size={20} className="text-white/60 animate-spin" />
                  </div>
                </div>

                <p className="font-semibold text-lg mb-2">{stageLabels[stage]}</p>

                {stage === "separating" && (
                  <p className="text-sm text-purple-300 mb-6">
                    Processing: <span className="font-medium">{stemLabels[activeStem]}</span>
                  </p>
                )}

                {/* Progress bar */}
                <div className="w-full bg-white/5 rounded-full h-1.5 mb-6 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-700"
                    style={{ width: `${stageProgress[stage]}%` }}
                  />
                </div>

                {/* Stem indicators */}
                <div className="flex justify-center gap-3">
                  {stemLabels.map((label, i) => (
                    <div
                      key={label}
                      className={`flex flex-col items-center gap-1.5 transition-all ${stage === "separating" && activeStem === i ? "opacity-100 scale-110" : "opacity-30"}`}
                    >
                      <div className={`w-2 h-2 rounded-full bg-gradient-to-br ${stemColors[i]}`} />
                      <span className="text-xs text-white/60">{label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
