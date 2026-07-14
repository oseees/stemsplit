import { chatJSON } from "./client";

export interface TrendCenter {
  trends: { title: string; description: string }[];
  hooks: string[];
  titleFormulas: string[];
  structures: { name: string; steps: string[] }[];
  disclaimer: string;
}

const SYSTEM = `You are a short-form content trend analyst.
Produce a snapshot of durable, pattern-based content strategies for the given niche.

RULES:
- These are PATTERNS and FORMULAS, not claims about what is trending this exact minute
  (you do not have live platform data). Make that explicit in "disclaimer".
- Everything must encourage original, transformative content.

Return STRICT JSON:
{
  "trends": [ { "title": string, "description": string } ],
  "hooks": [string],
  "titleFormulas": [string],
  "structures": [ { "name": string, "steps": [string] } ],
  "disclaimer": string
}`;

export async function getTrendCenter(niche?: string | null): Promise<TrendCenter> {
  return chatJSON<TrendCenter>({
    system: SYSTEM,
    user: `Niche: ${niche || "general creator content"}. Produce 6 trends, 8 popular hook patterns, 8 title formulas, and 4 content structures.`,
    temperature: 0.8,
    maxTokens: 2000,
  });
}
