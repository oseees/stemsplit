import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const YTDLP = process.env.YTDLP_PATH || "yt-dlp";

// yt-dlp shells out to ffmpeg to merge video+audio. When the server PATH lacks
// Homebrew, point it at ffmpeg's directory explicitly via FFMPEG_PATH.
const FF = process.env.FFMPEG_PATH || "";
const FFMPEG_DIR = FF.includes("/") ? path.dirname(FF) : "";

// Accepts watch, youtu.be, shorts, live and embed URLs.
const YT_RE =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)[\w-]+/i;

export function isYouTubeUrl(url: string): boolean {
  return YT_RE.test(url.trim());
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`yt-dlp failed (${code}): ${err.slice(-400) || out.slice(-400)}`)),
    );
  });
}

export interface DownloadedVideo {
  filePath: string;
  filename: string;
  title: string;
}

// Downloads a single YouTube video into destDir as one mp4 (<=1080p) and
// returns its local path plus a storage-safe filename. The URL is passed as a
// process arg (never through a shell), so it cannot inject commands.
export async function downloadYouTube(
  url: string,
  destDir: string,
): Promise<DownloadedVideo> {
  const clean = url.trim();
  if (!isYouTubeUrl(clean)) throw new Error("Not a valid YouTube URL");

  await run(YTDLP, [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    ...(FFMPEG_DIR ? ["--ffmpeg-location", FFMPEG_DIR] : []),
    // Cap resolution at 1080p — plenty for vertical clips while keeping the
    // download fast and within UploadThing's per-file size limit.
    "-f",
    "bv*[height<=1080]+ba/b[height<=1080]/b",
    // Guarantee an .mp4 container regardless of the source format.
    "--merge-output-format",
    "mp4",
    "--remux-video",
    "mp4",
    // Abort before downloading anything too big to store.
    "--max-filesize",
    "1000M",
    "-o",
    path.join(destDir, "%(title).80s.%(ext)s"),
    clean,
  ]);

  const files = (await readdir(destDir)).filter((f) => !f.startsWith("."));
  const produced = files.find((f) => f.toLowerCase().endsWith(".mp4")) ?? files[0];
  if (!produced) throw new Error("Download produced no file");

  const title = path.parse(produced).name;
  const safe =
    title.replace(/[^\w\- ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) ||
    "youtube-video";

  return {
    filePath: path.join(destDir, produced),
    filename: `${safe}.mp4`,
    title,
  };
}
