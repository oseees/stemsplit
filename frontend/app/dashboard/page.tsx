"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Music2, Download, Clock, Zap, Upload, ChevronRight, Loader2, Crown } from "lucide-react";
import { getHistory, isProUser, refreshProStatus, type Job } from "@/lib/api";

const stemColors = {
  vocals: "from-purple-500 to-pink-500",
  drums: "from-orange-500 to-red-500",
  bass: "from-blue-500 to-cyan-500",
  other: "from-green-500 to-emerald-500",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Dashboard() {
  const [history, setHistory] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState(false);

  useEffect(() => {
    getHistory().then((h) => { setHistory(h); setLoading(false); });
    setPro(isProUser());
    refreshProStatus().then(setPro).catch(() => {});
  }, []);

  const done = history.filter((j) => j.status === "done");
  const today = done.filter((j) => j.created_at && Date.now() - new Date(j.created_at).getTime() < 86400000);

  return (
    <div className="pt-16 min-h-screen px-6 py-12">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
            <p className="text-white/40 text-sm">Your stem separation history</p>
          </div>
          <Link
            href="/upload"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all font-medium text-sm shadow-lg shadow-purple-500/20"
          >
            <Upload size={16} />
            New Track
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-purple-500/20 flex items-center justify-center">
                <Music2 size={18} className="text-purple-400" />
              </div>
              <span className="text-sm text-white/50">Total Separations</span>
            </div>
            <p className="text-3xl font-black">{done.length}</p>
          </div>
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <Clock size={18} className="text-blue-400" />
              </div>
              <span className="text-sm text-white/50">Today</span>
            </div>
            <p className="text-3xl font-black">{today.length}<span className="text-sm font-normal text-white/30">{pro ? "" : " / 3"}</span></p>
          </div>
          <div className={`rounded-2xl p-5 ${pro ? "neon-border bg-gradient-to-b from-purple-900/20 to-blue-900/10" : "glass-card"}`}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${pro ? "bg-purple-500/20" : "bg-green-500/20"}`}>
                {pro ? <Crown size={18} className="text-purple-400" /> : <Zap size={18} className="text-green-400" />}
              </div>
              <span className="text-sm text-white/50">Plan</span>
            </div>
            <p className="text-3xl font-black">{pro ? <span className="gradient-text">Pro</span> : "Free"}</p>
          </div>
        </div>

        {/* Usage bar */}
        <div className="glass-card rounded-2xl p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium">Daily usage</p>
            <span className="text-sm text-white/40">
              {pro ? `${today.length} separations · unlimited` : `${today.length} / 3 free separations`}
            </span>
          </div>
          <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all"
              style={{ width: pro ? "100%" : `${Math.min((today.length / 3) * 100, 100)}%` }}
            />
          </div>
          {pro ? (
            <p className="text-xs text-purple-300 mt-2 flex items-center gap-1.5"><Crown size={12} /> Pro plan — unlimited separations & priority processing.</p>
          ) : today.length >= 3 ? (
            <p className="text-xs text-amber-400 mt-2">Daily limit reached. <Link href="/upgrade" className="underline">Upgrade to Pro</Link> for unlimited.</p>
          ) : null}
        </div>

        {/* History list */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Recent Separations</h2>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={32} className="animate-spin text-purple-400" />
            </div>
          ) : history.length === 0 ? (
            <div className="glass-card rounded-2xl p-12 text-center">
              <Music2 size={40} className="text-white/20 mx-auto mb-4" />
              <p className="text-white/40 mb-6">No tracks separated yet</p>
              <Link href="/upload" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all font-medium text-sm">
                Upload your first track
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((job) => (
                <div key={job.id} className="glass-card rounded-xl p-4 flex items-center gap-4 hover:border-white/12 transition-all">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center shrink-0">
                    <Music2 size={18} className="text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{job.filename || `Job ${job.id.slice(0, 8)}`}</p>
                    <p className="text-xs text-white/40 mt-0.5">{job.created_at ? timeAgo(job.created_at) : ""}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {Object.keys(stemColors).map((s) => (
                      <div key={s} className={`w-2 h-2 rounded-full bg-gradient-to-br ${stemColors[s as keyof typeof stemColors]}`} />
                    ))}
                  </div>
                  {job.status === "done" ? (
                    <Link
                      href={`/results?id=${job.id}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-card border border-white/10 hover:border-white/20 transition-all text-xs font-medium text-white/60 hover:text-white shrink-0"
                    >
                      <Download size={13} />
                      Download
                      <ChevronRight size={13} />
                    </Link>
                  ) : (
                    <span className={`text-xs px-2 py-1 rounded-md ${job.status === "error" ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                      {job.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
