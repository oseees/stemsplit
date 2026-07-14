import { chatJSON } from "./client";

export interface ClipContext {
  transcript: string;
  niche?: string | null;
  durationSec: number;
}

export interface ViralScores {
  virality: number;
  retention: number;
  engagement: number;
  reasons: string[];
  improvements: string[];
}

export interface Captions {
  curiosity: string;
  storytelling: string;
  educational: string;
  funny: string;
  motivational: string;
}

export interface Descriptions {
  tiktok: string;
  shorts: string;
  reels: string;
}

export interface Hashtags {
  general: string[];
  niche: string[];
  trending: string[];
}

export interface IntelligencePack {
  hooks: string[]; // 10
  titles: string[]; // 20
  captions: Captions;
  descriptions: Descriptions;
  hashtags: Hashtags;
  scores: ViralScores;
}

const SYSTEM = `You are a viral short-form content strategist.
Produce copy and predicted performance scores for a single clip.

RULES:
- Scores (0-100) are PREDICTIONS from content patterns, never guarantees.
- Hooks must be punchy, curiosity-driven, and honest (no clickbait that misrepresents).
- Promote original, transformative content. Never assist copyright circumvention.
- Hashtags must be plausible and relevant — do not invent fake trending tags as fact;
  "trending-style" means formatted like trends, clearly framed as suggestions.

Return STRICT JSON:
{
  "hooks": [string x10],
  "titles": [string x20],
  "captions": { "curiosity": string, "storytelling": string, "educational": string, "funny": string, "motivational": string },
  "descriptions": { "tiktok": string, "shorts": string, "reels": string },
  "hashtags": { "general": [string], "niche": [string], "trending": [string] },
  "scores": { "virality": int, "retention": int, "engagement": int, "reasons": [string], "improvements": [string] }
}`;

export async function generateIntelligence(
  ctx: ClipContext,
): Promise<IntelligencePack> {
  const user = `Clip length: ${ctx.durationSec}s
Niche: ${ctx.niche || "general"}

Clip transcript / description:
${ctx.transcript}

Generate exactly 10 hooks, 20 titles, 5 caption styles, 3 platform descriptions,
3 hashtag groups, and predicted scores with reasons + improvements.`;

  return chatJSON<IntelligencePack>({
    system: SYSTEM,
    user,
    temperature: 0.9,
    maxTokens: 3000,
  });
}
