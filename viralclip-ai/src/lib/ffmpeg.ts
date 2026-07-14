import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${bin} exited ${code}: ${err}`)),
    );
  });
}

export interface VideoMeta {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}

// Probe metadata from a local file path.
export async function probe(filePath: string): Promise<VideoMeta> {
  const json = await run(FFPROBE, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate:format=duration",
    "-of", "json",
    filePath,
  ]);
  const parsed = JSON.parse(json);
  const stream = parsed.streams?.[0] ?? {};
  const [num, den] = String(stream.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    durationSec: Number(parsed.format?.duration ?? 0),
    width: Number(stream.width ?? 0),
    height: Number(stream.height ?? 0),
    fps: den ? Number((num / den).toFixed(2)) : 0,
  };
}

// Cut a clip and re-encode to a vertical 9:16 short. Returns the mp4 bytes.
export async function renderVerticalClip(opts: {
  inputPath: string;
  startSec: number;
  endSec: number;
}): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "clip-"));
  const outPath = path.join(dir, "out.mp4");
  const duration = Math.max(0.5, opts.endSec - opts.startSec);

  try {
    await run(FFMPEG, [
      "-y",
      "-ss", String(opts.startSec),
      "-i", opts.inputPath,
      "-t", String(duration),
      // crop to 9:16 then scale to 1080x1920
      "-vf",
      "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Extract a mono 16kHz mp3 audio chunk for speech-to-text. Compressing to
// 64kbps mono keeps each chunk well under transcription API size limits.
// Returns the path to the chunk file inside `dir` (caller cleans up `dir`).
export async function extractAudioChunk(opts: {
  inputPath: string;
  startSec: number;
  durationSec: number;
  dir: string;
  index: number;
}): Promise<string> {
  const outPath = path.join(opts.dir, `audio-${opts.index}.mp3`);
  await run(FFMPEG, [
    "-y",
    "-ss", String(opts.startSec),
    "-i", opts.inputPath,
    "-t", String(opts.durationSec),
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-b:a", "64k",
    outPath,
  ]);
  return outPath;
}

// Grab a single-frame JPEG thumbnail at a timestamp.
export async function renderThumbnail(opts: {
  inputPath: string;
  atSec: number;
}): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "thumb-"));
  const outPath = path.join(dir, "thumb.jpg");
  try {
    await run(FFMPEG, [
      "-y",
      "-ss", String(opts.atSec),
      "-i", opts.inputPath,
      "-frames:v", "1",
      "-vf", "scale=720:-1",
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
