import { chatJSON } from "./client";
import type {
  Moment,
  RetentionReport,
  ClipLength,
} from "@/types/database";

export interface AnalysisInput {
  durationSec: number;
  // Timestamped transcript segments. Produced by a speech-to-text step
  // (e.g. Whisper). If unavailable, pass a single segment with the full text.
  transcript: { start: number; end: number; text: string }[];
  niche?: string | null;
}

export interface AnalysisResult {
  moments: Moment[];
  retention: RetentionReport;
  summary: string;
}

const SYSTEM = `You are a short-form video strategist for TikTok, YouTube Shorts and Instagram Reels.
You analyze a timestamped transcript of a long-form video and identify the moments most likely to perform well as short clips.

IMPORTANT RULES:
- Scores are PREDICTIONS based on content patterns, never guarantees of virality.
- Encourage original, transformative content. Never help bypass copyright.
- Be specific and reference the transcript timing.

Return STRICT JSON with this shape:
{
  "moments": [
    { "start": number, "end": number, "type": "hook|emotional|high-energy|suspense|funny|educational", "intensity": number(0-1), "reason": string }
  ],
  "retention": {
    "sections": [ { "start": number, "end": number, "label": "strong|weak|dropoff", "note": string } ],
    "recommendations": [ { "at": number, "action": "add-zoom|add-caption|cut|add-broll", "detail": string } ],
    "dropoffPoints": [ number ]
  },
  "summary": string
}`;

export async function analyzeVideo(
  input: AnalysisInput,
): Promise<AnalysisResult> {
  const transcriptText = input.transcript
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join("\n");

  const user = `Video duration: ${input.durationSec}s
Creator niche: ${input.niche || "general"}

Transcript:
${transcriptText}

Identify 6-12 high-potential moments across all categories and produce a retention report.`;

  return chatJSON<AnalysisResult>({
    system: SYSTEM,
    user,
    temperature: 0.6,
    maxTokens: 8000,
    // Analysis is structured extraction — a fast model handles it well and cuts
    // the slowest pipeline step roughly in half. Override with AI_ANALYSIS_MODEL.
    model: process.env.AI_ANALYSIS_MODEL || undefined,
  });
}

const LENGTH_SECONDS: Record<ClipLength, number> = {
  s15: 15,
  s30: 30,
  s60: 60,
};

export interface DetectedClip {
  length: ClipLength;
  start: number;
  end: number;
  anchorReason: string;
}

// Deterministic clip detection: center a window of each target length on the
// strongest moments, clamped to the video bounds. No AI call needed.
export function detectClips(
  moments: Moment[],
  durationSec: number,
): DetectedClip[] {
  const ranked = [...moments].sort((a, b) => b.intensity - a.intensity);
  const clips: DetectedClip[] = [];
  const lengths: ClipLength[] = ["s15", "s30", "s60"];

  for (const m of ranked.slice(0, 8)) {
    for (const len of lengths) {
      const window = LENGTH_SECONDS[len];
      const center = (m.start + m.end) / 2;
      let start = Math.max(0, center - window / 2);
      let end = start + window;
      if (end > durationSec) {
        end = durationSec;
        start = Math.max(0, end - window);
      }
      clips.push({
        length: len,
        start: Number(start.toFixed(2)),
        end: Number(end.toFixed(2)),
        anchorReason: m.reason,
      });
    }
  }
  return clips;
}
