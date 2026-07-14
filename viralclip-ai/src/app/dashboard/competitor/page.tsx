"use client";

import { useState } from "react";
import { Search } from "lucide-react";

interface Report {
  hook_strength: number | null;
  editing_pace: string | null;
  structure: string | null;
  engagement_drivers: string[];
  recommendations: string[];
}

export default function CompetitorPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    setReport(null);
    const res = await fetch("/api/competitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) setReport(data.report);
    else setError(data.error);
  }

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <h1 className="text-2xl font-semibold tracking-tight">Competitor analyzer</h1>
      <p className="mt-1 text-sm text-white/50">
        Paste a TikTok, Shorts or Reel URL to extract transferable strategies for your
        own original content.
      </p>

      <div className="mt-6 flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.tiktok.com/@user/video/..."
          className="flex-1 rounded-lg border border-bg-border bg-bg-card px-3 py-2.5 text-sm outline-none focus:border-brand"
        />
        <button onClick={analyze} disabled={loading || !url} className="btn-primary">
          <Search size={15} /> {loading ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {report && (
        <div className="mt-6 space-y-4">
          <div className="card p-4">
            <p className="text-sm text-white/50">Hook strength (predicted)</p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-bg-border">
              <div className="h-full bg-brand" style={{ width: `${report.hook_strength ?? 0}%` }} />
            </div>
            <p className="mt-1 text-xs text-white/40">{report.hook_strength}/100</p>
          </div>
          <div className="card p-4">
            <h4 className="font-semibold">Editing pace</h4>
            <p className="mt-1 text-sm text-white/60">{report.editing_pace}</p>
          </div>
          <div className="card p-4">
            <h4 className="font-semibold">Structure</h4>
            <p className="mt-1 text-sm text-white/60">{report.structure}</p>
          </div>
          <div className="card p-4">
            <h4 className="font-semibold">Engagement drivers</h4>
            <ul className="mt-1 space-y-1 text-sm text-white/60">
              {report.engagement_drivers?.map((d, i) => <li key={i}>• {d}</li>)}
            </ul>
          </div>
          <div className="card p-4">
            <h4 className="font-semibold">Recommendations</h4>
            <ul className="mt-1 space-y-1 text-sm text-white/60">
              {report.recommendations?.map((r, i) => <li key={i}>→ {r}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
