import { chatText, ai } from "./client";
import type { NarrationMode } from "@/types/database";

const MODE_GUIDE: Record<NarrationMode, string> = {
  storytelling: "Narrative arc, tension and payoff, second-person pull.",
  documentary: "Calm, authoritative, factual framing with vivid detail.",
  educational: "Clear, structured, one idea at a time, plain language.",
  motivational: "Energetic, direct, empowering call to action.",
  news: "Punchy, present-tense, lead with the most important fact.",
};

export async function generateNarration(opts: {
  mode: NarrationMode;
  transcript: string;
  durationSec: number;
  niche?: string | null;
}): Promise<string> {
  const system = `You write voiceover narration scripts for short-form vertical video.
Style for "${opts.mode}": ${MODE_GUIDE[opts.mode]}
Write only the spoken script — no stage directions, no markdown.
Pace it for roughly ${opts.durationSec} seconds of speech.
Keep content original and transformative.`;

  const user = `Niche: ${opts.niche || "general"}
Source clip content:
${opts.transcript}`;

  return chatText({ system, user, temperature: 0.85, maxTokens: 800 });
}

// Optional text-to-speech. Returns an audio Buffer (mp3) for callers to store.
// Throws if the configured AI provider has no audio.speech endpoint.
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const res = await ai.audio.speech.create({
    model: process.env.AI_TTS_MODEL || "tts-1",
    voice: (process.env.AI_TTS_VOICE || "alloy") as never,
    input: text,
  });
  return Buffer.from(await res.arrayBuffer());
}
