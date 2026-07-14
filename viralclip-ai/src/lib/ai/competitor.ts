import { chatJSON } from "./client";
import type { Platform } from "@/types/database";

export interface CompetitorAnalysis {
  platform: Platform | null;
  hookStrength: number; // 0-100
  editingPace: string;
  structure: string;
  engagementDrivers: string[];
  recommendations: string[];
}

const SYSTEM = `You analyze short-form videos to extract transferable lessons.
You are given a URL and any available metadata/transcript. If you only have a URL,
reason about the likely format from the platform and the creator's description, and
say clearly that the analysis is based on limited signals.

RULES:
- Goal is to help the user create ORIGINAL, transformative content — never to copy.
- Recommendations must be actionable and specific.

Return STRICT JSON:
{
  "platform": "tiktok|shorts|reels|null",
  "hookStrength": int(0-100),
  "editingPace": string,
  "structure": string,
  "engagementDrivers": [string],
  "recommendations": [string]
}`;

export function detectPlatform(url: string): Platform | null {
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/youtube\.com\/shorts|youtu\.be/i.test(url)) return "shorts";
  if (/instagram\.com\/(reel|reels)/i.test(url)) return "reels";
  return null;
}

export async function analyzeCompetitor(opts: {
  url: string;
  transcript?: string;
  niche?: string | null;
}): Promise<CompetitorAnalysis> {
  const platform = detectPlatform(opts.url);
  const user = `URL: ${opts.url}
Detected platform: ${platform ?? "unknown"}
Niche context: ${opts.niche || "general"}
${opts.transcript ? `Transcript / caption:\n${opts.transcript}` : "No transcript available — reason from URL and platform conventions."}

Analyze the hook, editing pace, structure, engagement drivers, and give recommendations
the user can apply to their OWN original content.`;

  return chatJSON<CompetitorAnalysis>({
    system: SYSTEM,
    user,
    temperature: 0.6,
    maxTokens: 1500,
  });
}
