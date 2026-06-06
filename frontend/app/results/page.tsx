"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Mic2, Drum, Waves, Music, Download, ArrowLeft,
  Loader2, Play, Pause, Package
} from "lucide-react";
import { getJobStatus, getDownloadUrl, type Job } from "@/lib/api";

const stems = [
  { key: "vocals", label: "Vocals", icon: Mic2, color: "from-purple-500 to-pink-500", bg: "bg-purple-500/10 border-purple-500/20" },
  { key: "drums", label: "Drums", icon: Drum, color: "from-orange-500 to-red-500", bg: "bg-orange-500/10 border-orange-500/20" },
  { key: "bass", label: "Bass", icon: Waves, color: "from-blue-500 to-cyan-500", bg: "bg-blue-500/10 border-blue-500/20" },
  { key: "other", label: "Other", icon: Music, color: "from-green-500 to-emerald-500", bg: "bg-green-500/10 border-green-500/20" },
] as const;

function AudioPlayer({ src, label, color, bg }: { src: string; label: string; color: string; bg: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className={`glass-card rounded-xl p-4 border ${bg} flex items-center gap-4`}>
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => {
          const a = audioRef.current;
          if (a) setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
        }}
        onLoadedMetadata={() => { if (audioRef.current) setDuration(audioRef.current.duration); }}
        onEnded={() => setPlaying(false)}
      />
      <button
        onClick={toggle}
        className={`w-10 h-10 rounded-full bg-gradient-to-br ${color} flex items-center justify-center shrink-0 hover:scale-105 transition-transform`}
      >
        {playing ? <Pause size={16} className="text-white" /> : <Play size={16} className="text-white ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium mb-1.5">{label}</p>
        <div
          className="w-full h-1 bg-white/10 rounded-full cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const a = audioRef.current;
            if (a && a.duration) { a.currentTime = pct * a.duration; setProgress(pct * 100); }
          }}
        >
          <div className={`h-full bg-gradient-to-r ${color} rounded-full transition-all`} style={{ width: `${progress}%` }} />
        </div>
      </div>
      <span className="text-xs text-white/40 shrink-0">{duration ? fmt(duration) : "--:--"}</span>
    </div>
  );
}

function ResultsContent() {
  const params = useSearchParams();
  const jobId = params.get("id");
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!jobId) { setError("No job ID provided."); setLoading(false); return; }

    const poll = async () => {
      try {
        const j = await getJobStatus(jobId);
        setJob(j);
        if (j.status === "done" || j.status === "error") setLoading(false);
        else setTimeout(poll, 1000);
      } catch {
        setError("Failed to fetch job status.");
        setLoading(false);
      }
    };
    poll();
  }, [jobId]);

  if (!jobId) return <ErrorState msg="No job ID in URL." />;
  if (loading) return <LoadingState job={job} />;
  if (error || job?.status === "error") return <ErrorState msg={error || job?.error || "Processing failed."} />;
  if (!job?.stems) return <ErrorState msg="No stems found." />;

  return (
    <div className="w-full max-w-2xl">
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card text-green-400 border border-green-500/20 text-sm mb-4">
          <span className="w-2 h-2 rounded-full bg-green-400" />
          Stems ready
        </div>
        <h1 className="text-3xl font-bold mb-2">Your <span className="gradient-text">Stems</span></h1>
        {job.filename && <p className="text-white/40 text-sm">{job.filename}</p>}
      </div>

      {/* Audio players */}
      <div className="space-y-3 mb-8">
        {stems.map(({ key, label, color, bg }) => (
          <div key={key} className="group relative">
            <AudioPlayer
              src={getDownloadUrl(jobId, key)}
              label={label}
              color={color}
              bg={bg}
            />
            <a
              href={getDownloadUrl(jobId, key)}
              download
              className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-lg hover:bg-white/10"
            >
              <Download size={16} className="text-white/60" />
            </a>
          </div>
        ))}
      </div>

      {/* Download all */}
      <a
        href={getDownloadUrl(jobId, "zip")}
        download
        className="flex items-center justify-center gap-3 w-full py-4 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all font-semibold shadow-lg shadow-purple-500/20 mb-4"
      >
        <Package size={20} />
        Download All Stems (ZIP)
      </a>

      {/* Individual downloads */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        {stems.map(({ key, label, color }) => (
          <a
            key={key}
            href={getDownloadUrl(jobId, key)}
            download
            className="flex items-center gap-2 py-2.5 px-4 rounded-xl glass-card border border-white/10 hover:border-white/20 transition-all text-sm font-medium text-white/70 hover:text-white"
          >
            <div className={`w-2 h-2 rounded-full bg-gradient-to-br ${color}`} />
            Download {label}
          </a>
        ))}
      </div>

      <div className="flex justify-between items-center">
        <Link href="/upload" className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors">
          <ArrowLeft size={16} /> New separation
        </Link>
        <Link href="/dashboard" className="text-sm text-white/50 hover:text-white transition-colors">
          View history →
        </Link>
      </div>
    </div>
  );
}

function LoadingState({ job }: { job: Job | null }) {
  const stemLabels = ["Vocals", "Drums", "Bass", "Other"];
  const stemColors = ["from-purple-500 to-pink-500", "from-orange-500 to-red-500", "from-blue-500 to-cyan-500", "from-green-500 to-emerald-500"];
  const progress = job?.progress ?? 0;

  return (
    <div className="w-full max-w-md text-center">
      {/* Spinner */}
      <div className="relative w-20 h-20 mx-auto mb-6">
        <div className="absolute inset-0 rounded-full border-4 border-white/5" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-purple-500 animate-spin" />
        <div className="absolute inset-2 rounded-full border-4 border-transparent border-t-blue-400 animate-spin" style={{ animationDuration: "1.5s", animationDirection: "reverse" }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={18} className="text-white/40 animate-spin" />
        </div>
      </div>

      <p className="font-semibold text-lg mb-1">
        {job?.stage || "Processing your track..."}
      </p>
      <p className="text-sm text-white/40 mb-6">This usually takes 30–90 seconds</p>

      {/* Progress bar */}
      <div className="w-full bg-white/5 rounded-full h-1.5 mb-6 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-1000"
          style={{ width: `${Math.max(progress, 5)}%` }}
        />
      </div>

      {/* Stem dots */}
      <div className="flex justify-center gap-4">
        {stemLabels.map((label, i) => (
          <div key={label} className="flex flex-col items-center gap-1.5 opacity-50">
            <div className={`w-2 h-2 rounded-full bg-gradient-to-br ${stemColors[i]}`} />
            <span className="text-xs text-white/50">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ msg }: { msg: string }) {
  return (
    <div className="text-center">
      <p className="text-red-400 font-semibold mb-4">{msg}</p>
      <Link href="/upload" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl glass-card border border-white/10 hover:border-white/20 transition-all text-sm">
        <ArrowLeft size={16} /> Try again
      </Link>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <div className="pt-16 min-h-screen flex flex-col items-center justify-center px-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-purple-600/8 blur-[100px]" />
      </div>
      <Suspense fallback={<LoadingState job={null} />}>
        <ResultsContent />
      </Suspense>
    </div>
  );
}
