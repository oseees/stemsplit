import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import OpenAI from "openai";
import { extractAudioChunk } from "@/lib/ffmpeg";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

// Speech-to-text runs on its own provider, independent of the chat model.
// Anthropic (Claude) has no STT, so chat can use Claude while transcription
// points at any OpenAI-compatible STT API (Groq, OpenAI, local Whisper, ...).
// Defaults to Groq, which offers whisper-large-v3-turbo on a free tier and
// returns verbose_json with segment timestamps.
const stt = new OpenAI({
  apiKey: process.env.STT_API_KEY || process.env.AI_API_KEY || "placeholder",
  baseURL: process.env.STT_BASE_URL || "https://api.groq.com/openai/v1",
});

const TRANSCRIBE_MODEL =
  process.env.STT_MODEL ||
  process.env.AI_TRANSCRIBE_MODEL ||
  "whisper-large-v3-turbo";

// At 64kbps mono, ~20 min ≈ 9.6MB — comfortably under the typical 25MB limit.
const CHUNK_SECONDS = 1200;

// Shape of OpenAI's verbose_json transcription (only the fields we use).
interface VerboseTranscription {
  text: string;
  segments?: { start: number; end: number; text: string }[];
}

// Transcribe a local video/audio file into timestamped segments.
// Splits long media into chunks and offsets each chunk's timestamps so the
// returned timeline is continuous across the whole file.
export async function transcribeFile(
  inputPath: string,
  durationSec: number,
): Promise<TranscriptSegment[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "stt-"));
  const segments: TranscriptSegment[] = [];

  try {
    const chunkCount = Math.max(1, Math.ceil(durationSec / CHUNK_SECONDS));

    for (let i = 0; i < chunkCount; i++) {
      const startSec = i * CHUNK_SECONDS;
      const chunkDuration = Math.min(CHUNK_SECONDS, durationSec - startSec);
      if (chunkDuration <= 0) break;

      const audioPath = await extractAudioChunk({
        inputPath,
        startSec,
        durationSec: chunkDuration,
        dir,
        index: i,
      });

      const result = (await stt.audio.transcriptions.create({
        file: createReadStream(audioPath),
        model: TRANSCRIBE_MODEL,
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      })) as unknown as VerboseTranscription;

      if (result.segments?.length) {
        for (const s of result.segments) {
          segments.push({
            start: Number((s.start + startSec).toFixed(2)),
            end: Number((s.end + startSec).toFixed(2)),
            text: s.text.trim(),
          });
        }
      } else if (result.text?.trim()) {
        // Provider returned plain text without segments — keep it as one block.
        segments.push({
          start: startSec,
          end: startSec + chunkDuration,
          text: result.text.trim(),
        });
      }
    }

    return segments;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
