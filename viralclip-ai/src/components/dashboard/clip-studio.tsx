"use client";

import { useState } from "react";
import { Copy, RefreshCw, Download, Sparkles, Mic } from "lucide-react";
import { fmtDuration } from "@/lib/utils";
import { ScoreRing } from "@/components/dashboard/stat-card";
import type {
  Clip,
  Analysis,
  RetentionReport,
  NarrationMode,
} from "@/types/database";
import type { IntelligencePack } from "@/lib/ai/intelligence";

const NARRATION_MODES: NarrationMode[] = [
  "storytelling",
  "documentary",
  "educational",
  "motivational",
  "news",
];

type Tab = "clips" | "retention" | "intelligence" | "narration";

export function ClipStudio({
  clips: initialClips,
  analysis,
  canIntel,
  canNarrate,
}: {
  clips: Clip[];
  analysis: Analysis | null;
  canIntel: boolean;
  canNarrate: boolean;
}) {
  const [tab, setTab] = useState<Tab>("clips");
  const [clips, setClips] = useState(initialClips);
  const [selected, setSelected] = useState<Clip | null>(initialClips[0] ?? null);

  return (
    <div>
      <div className="mb-5 flex gap-1 rounded-lg border border-bg-border bg-bg-card p-1 text-sm">
        {(["clips", "retention", "intelligence", "narration"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 capitalize transition ${
              tab === t ? "bg-brand text-white" : "text-white/60 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "clips" && (
        <ClipsTab clips={clips} setClips={setClips} onSelect={setSelected} />
      )}
      {tab === "retention" && <RetentionTab retention={analysis?.retention ?? null} />}
      {tab === "intelligence" && (
        <IntelligenceTab clip={selected} clips={clips} setSelected={setSelected} enabled={canIntel} />
      )}
      {tab === "narration" && (
        <NarrationTab clip={selected} clips={clips} setSelected={setSelected} enabled={canNarrate} />
      )}
    </div>
  );
}

function ClipsTab({
  clips,
  setClips,
  onSelect,
}: {
  clips: Clip[];
  setClips: (c: Clip[]) => void;
  onSelect: (c: Clip) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function adjust(id: string, patch: Partial<Clip>) {
    const res = await fetch("/api/clips", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, startSec: patch.start_sec, endSec: patch.end_sec }),
    });
    if (res.ok) {
      const { clip } = await res.json();
      setClips(clips.map((c) => (c.id === id ? clip : c)));
    }
  }

  async function exportClip(id: string) {
    setBusy(id);
    const res = await fetch("/api/clips/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipId: id }),
    });
    const data = await res.json();
    setBusy(null);
    if (res.ok && data.downloadUrl) window.open(data.downloadUrl, "_blank");
    else alert(data.error ?? "Export failed (ffmpeg required on host)");
  }

  const labels: Record<string, string> = { s15: "15s", s30: "30s", s60: "60s" };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {clips.length === 0 && (
        <p className="text-sm text-white/50">No clips yet. Run analysis on an upload.</p>
      )}
      {clips.map((c) => (
        <div key={c.id} className="card p-4" onMouseEnter={() => onSelect(c)}>
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
              {labels[c.length]}
            </span>
            <span className="text-xs text-white/40">
              {fmtDuration(c.start_sec)} → {fmtDuration(c.end_sec)}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm text-white/70">{c.title}</p>

          <div className="mt-3 flex items-center gap-2 text-xs">
            <label className="text-white/40">Start</label>
            <input
              type="number"
              defaultValue={Math.round(c.start_sec)}
              onBlur={(e) => adjust(c.id, { start_sec: Number(e.target.value), end_sec: c.end_sec })}
              className="w-16 rounded border border-bg-border bg-bg px-2 py-1"
            />
            <label className="text-white/40">End</label>
            <input
              type="number"
              defaultValue={Math.round(c.end_sec)}
              onBlur={(e) => adjust(c.id, { start_sec: c.start_sec, end_sec: Number(e.target.value) })}
              className="w-16 rounded border border-bg-border bg-bg px-2 py-1"
            />
          </div>

          <button
            onClick={() => exportClip(c.id)}
            disabled={busy === c.id}
            className="btn-ghost mt-3 w-full"
          >
            <Download size={14} /> {busy === c.id ? "Exporting…" : "Export 9:16"}
          </button>
        </div>
      ))}
    </div>
  );
}

function RetentionTab({ retention }: { retention: RetentionReport | null }) {
  if (!retention?.sections?.length) {
    return <p className="text-sm text-white/50">No retention analysis available.</p>;
  }
  const color = { strong: "bg-accent", weak: "bg-yellow-500", dropoff: "bg-red-500" };
  const max = Math.max(...retention.sections.map((s) => s.end), 1);

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm text-white/50">Timeline</p>
        <div className="relative h-8 overflow-hidden rounded-lg bg-bg-card">
          {retention.sections.map((s, i) => (
            <div
              key={i}
              title={s.note}
              className={`absolute top-0 h-full opacity-70 ${color[s.label]}`}
              style={{ left: `${(s.start / max) * 100}%`, width: `${((s.end - s.start) / max) * 100}%` }}
            />
          ))}
          {retention.dropoffPoints?.map((p, i) => (
            <div key={`d${i}`} className="absolute top-0 h-full w-0.5 bg-white" style={{ left: `${(p / max) * 100}%` }} />
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-xs text-white/40">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" />Strong</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-yellow-500" />Weak</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />Drop-off</span>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm text-white/50">Recommendations</p>
        <ul className="space-y-2">
          {retention.recommendations.map((r, i) => (
            <li key={i} className="card flex items-start gap-3 p-3 text-sm">
              <span className="rounded bg-brand-soft px-2 py-0.5 text-xs text-brand">
                {fmtDuration(r.at)}
              </span>
              <span className="text-white/70">
                <strong className="capitalize text-white">{r.action.replace("-", " ")}:</strong> {r.detail}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ClipPicker({
  clips,
  selected,
  setSelected,
}: {
  clips: Clip[];
  selected: Clip | null;
  setSelected: (c: Clip) => void;
}) {
  return (
    <select
      value={selected?.id ?? ""}
      onChange={(e) => setSelected(clips.find((c) => c.id === e.target.value)!)}
      className="mb-4 w-full rounded-lg border border-bg-border bg-bg-card px-3 py-2 text-sm"
    >
      {clips.map((c) => (
        <option key={c.id} value={c.id}>
          {fmtDuration(c.start_sec)}–{fmtDuration(c.end_sec)} · {c.title?.slice(0, 40)}
        </option>
      ))}
    </select>
  );
}

function copy(text: string) {
  navigator.clipboard.writeText(text);
}

function IntelligenceTab({
  clip,
  clips,
  setSelected,
  enabled,
}: {
  clip: Clip | null;
  clips: Clip[];
  setSelected: (c: Clip) => void;
  enabled: boolean;
}) {
  const [pack, setPack] = useState<IntelligencePack | null>(null);
  const [loading, setLoading] = useState(false);

  if (!enabled) return <UpgradeNotice feature="Viral Intelligence" />;
  if (!clip) return <p className="text-sm text-white/50">No clip selected.</p>;

  async function generate() {
    setLoading(true);
    const res = await fetch("/api/intelligence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipId: clip!.id, transcript: clip!.title }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) setPack(data);
    else alert(data.error);
  }

  return (
    <div>
      <ClipPicker clips={clips} selected={clip} setSelected={setSelected} />
      <button onClick={generate} disabled={loading} className="btn-primary mb-4">
        <Sparkles size={15} /> {loading ? "Generating…" : "Generate intelligence"}
      </button>

      {pack && (
        <div className="space-y-5">
          <div className="card p-4">
            <div className="flex justify-around">
              <ScoreRing value={pack.scores.virality} label="Virality" />
              <ScoreRing value={pack.scores.retention} label="Retention" />
              <ScoreRing value={pack.scores.engagement} label="Engagement" />
            </div>
            <p className="mt-3 text-center text-xs text-white/40">
              Predicted scores — not a guarantee of performance.
            </p>
            <Block title="Why" items={pack.scores.reasons} />
            <Block title="Improvements" items={pack.scores.improvements} />
          </div>

          <ListBlock title="Hooks (10)" items={pack.hooks} />
          <ListBlock title="Titles (20)" items={pack.titles} />

          <div className="card p-4">
            <h4 className="mb-2 font-semibold">Captions</h4>
            {Object.entries(pack.captions).map(([style, text]) => (
              <CopyRow key={style} label={style} text={text} />
            ))}
          </div>

          <div className="card p-4">
            <h4 className="mb-2 font-semibold">Descriptions</h4>
            {Object.entries(pack.descriptions).map(([p, text]) => (
              <CopyRow key={p} label={p} text={text} />
            ))}
          </div>

          <div className="card p-4">
            <h4 className="mb-2 font-semibold">Hashtags</h4>
            {Object.entries(pack.hashtags).map(([group, tags]) => (
              <CopyRow key={group} label={group} text={(tags as string[]).join(" ")} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NarrationTab({
  clip,
  clips,
  setSelected,
  enabled,
}: {
  clip: Clip | null;
  clips: Clip[];
  setSelected: (c: Clip) => void;
  enabled: boolean;
}) {
  const [mode, setMode] = useState<NarrationMode>("storytelling");
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);

  if (!enabled) return <UpgradeNotice feature="AI Narration" />;
  if (!clip) return <p className="text-sm text-white/50">No clip selected.</p>;

  async function generate() {
    setLoading(true);
    const res = await fetch("/api/narration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clipId: clip!.id,
        mode,
        transcript: clip!.title,
        durationSec: clip!.end_sec - clip!.start_sec,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) setScript(data.narration.script);
    else alert(data.error);
  }

  return (
    <div>
      <ClipPicker clips={clips} selected={clip} setSelected={setSelected} />
      <div className="mb-4 flex flex-wrap gap-2">
        {NARRATION_MODES.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1 text-xs capitalize ${
              mode === m ? "bg-brand text-white" : "border border-bg-border text-white/60"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <button onClick={generate} disabled={loading} className="btn-primary mb-4">
        <Mic size={15} /> {loading ? "Writing…" : "Generate script"}
      </button>

      {script && (
        <div className="card p-4">
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={10}
            className="w-full resize-none rounded-lg border border-bg-border bg-bg p-3 text-sm outline-none focus:border-brand"
          />
          <div className="mt-3 flex gap-2">
            <button onClick={() => copy(script)} className="btn-ghost">
              <Copy size={14} /> Copy
            </button>
            <button onClick={generate} className="btn-ghost">
              <RefreshCw size={14} /> Regenerate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-4">
      <p className="mb-1 text-sm font-medium text-white/70">{title}</p>
      <ul className="space-y-1 text-sm text-white/55">
        {items?.map((i, idx) => <li key={idx}>• {i}</li>)}
      </ul>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-semibold">{title}</h4>
        <button onClick={() => copy(items.join("\n"))} className="text-xs text-white/50 hover:text-white">
          Copy all
        </button>
      </div>
      <ul className="grid gap-1 text-sm text-white/70 sm:grid-cols-2">
        {items.map((i, idx) => (
          <li key={idx} className="group flex items-start justify-between gap-2 rounded px-2 py-1 hover:bg-white/5">
            <span>{i}</span>
            <button onClick={() => copy(i)} className="opacity-0 transition group-hover:opacity-100">
              <Copy size={13} className="text-white/40" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="mb-2 rounded-lg border border-bg-border p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-white/40">{label}</span>
        <button onClick={() => copy(text)} className="text-white/40 hover:text-white">
          <Copy size={13} />
        </button>
      </div>
      <p className="mt-1 text-sm text-white/70">{text}</p>
    </div>
  );
}

function UpgradeNotice({ feature }: { feature: string }) {
  return (
    <div className="card p-6 text-center">
      <p className="font-medium">{feature} is a Pro feature</p>
      <p className="mt-1 text-sm text-white/50">Upgrade to unlock it.</p>
      <a href="/dashboard/billing" className="btn-primary mt-4">Upgrade</a>
    </div>
  );
}
