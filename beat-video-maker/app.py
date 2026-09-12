# BeatVideo — upload a beat + images/video clips, get a YouTube-ready MP4.
# The clips are stitched silently and the beat becomes the audio track.
import json
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from starlette.background import BackgroundTask

app = FastAPI(title="BeatVideo")

FPS = 30
# frame size per platform. "fill" centre-crops to cover (what Reels/TikTok expect);
# "fit" letterboxes so nothing is cropped (kept for YouTube landscape).
FORMATS = {
    "landscape": (1920, 1080, "fit"),   # YouTube
    "vertical": (1080, 1920, "fill"),   # Reels / TikTok / YouTube Shorts
    "square": (1080, 1080, "fill"),     # Instagram feed
}
IMAGE_SECONDS = 4  # ponytail: fixed per-image duration, make it a form field if requested
MAX_CLIP_SECONDS = 5.0  # keep clips short to reduce copyright-strike risk
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}

# fixed presets only — never accept raw filter strings from the client
FILTERS = {
    "none": "",
    "bw": "hue=s=0",
    "warm": "colortemperature=4500",
    "cool": "colortemperature=8500",
    "punch": "eq=contrast=1.25:saturation=1.5",
    "vhs": "curves=vintage,noise=alls=10:allf=t",
}


def run(cmd: list[str]) -> None:
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr[-2000:])


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


_FONT_CANDIDATES = {  # label -> macOS font path; filtered to what's actually installed
    "Clean Sans": "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "Impact": "/System/Library/Fonts/Supplemental/Impact.ttf",
    "Engraved": "/System/Library/Fonts/Supplemental/Copperplate.ttc",
    "Modern": "/System/Library/Fonts/Avenir Next.ttc",
    "Techy Mono": "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
    "Handwritten": "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
    "Serif": "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
}
FONTS = {name: p for name, p in _FONT_CANDIDATES.items() if Path(p).exists()}
FONT = next(iter(FONTS.values()), None)  # default = first available

VISUALIZERS = {  # audio -> thin monochrome line (ffmpeg drawtext isn't in this build)
    "waveform": "showwaves=s={w}x{s}:mode=line:rate={fps}:colors=0xFFFFFF",
    "bars": "showfreqs=s={w}x{s}:mode=line:ascale=log:fscale=log:colors=0xFFFFFF",
}


def make_tag_png(text: str, out: Path, w: int, h: int, font_path: Optional[str] = None) -> None:
    """Render a producer tag to a transparent PNG (Pillow bundles freetype; our
    ffmpeg has no drawtext). Clean white text with a soft drop shadow — no box,
    stays legible on busy footage without looking tacky."""
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    fs = max(h // 42, 13)  # small, subtle watermark
    fp = font_path or FONT
    font = ImageFont.truetype(fp, fs) if fp else ImageFont.load_default()
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    tw, th, margin = r - l, b - t, max(h // 24, 22)
    x, y = w - tw - margin - l, h - th - margin - t
    # faint blurred shadow just for legibility; the text itself is low-opacity
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((x, y), text, font=font, fill=(0, 0, 0, 130))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(fs // 5 or 1)))
    d.text((x, y), text, font=font, fill=(255, 255, 255, 150))
    img.save(out)


def base_vf(fmt: str = "landscape") -> str:
    """ffmpeg filter that fits the source into the chosen frame size."""
    w, h, mode = FORMATS[fmt]
    if mode == "fill":  # cover the frame, crop the overflow — no black bars
        sizing = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}"
    else:               # letterbox so nothing gets cut off
        sizing = (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                  f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2")
    return f"{sizing},fps={FPS},format=yuv420p"


VF = base_vf("landscape")  # default; build()/normalize() take an explicit one


def detect_beats(beat: Path) -> tuple[float, float, float]:
    """(seconds per cut, first-beat offset, bpm). Cut length is a whole number of
    beats (~one bar), so video cuts land on the beat grid. Falls back to (4, 0, 0)."""
    import librosa  # already in the shared venv (track2midi); lazy so startup stays fast
    wav = beat.parent / "beat_mono.wav"
    run(["ffmpeg", "-y", "-i", str(beat), "-ac", "1", "-ar", "22050", "-t", "60", str(wav)])
    y, sr = librosa.load(str(wav), sr=22050, mono=True)
    tempo, frames = librosa.beat.beat_track(y=y, sr=sr)
    times = librosa.frames_to_time(frames, sr=sr)
    if len(times) < 4:
        return 4.0, 0.0, 0.0
    # average spacing of tracked beats is more accurate than the quantized tempo scalar
    beat_sec = (times[-1] - times[0]) / (len(times) - 1)
    bpm = 60.0 / beat_sec
    per_cut = 4 * beat_sec  # one 4/4 bar
    while per_cut > MAX_CLIP_SECONDS:
        per_cut /= 2
    while per_cut < 1.5:
        per_cut *= 2
    offset = float(times[0])
    return round(per_cut, 3), round(offset if offset >= 0.3 else 0.0, 3), round(bpm, 1)


def scene_starts(src: Path) -> list[float]:
    """Timestamps where ffmpeg detects a scene change (the video's own cuts)."""
    p = subprocess.run(
        ["ffmpeg", "-i", str(src), "-an", "-vf", "select='gt(scene,0.3)',showinfo",
         "-f", "null", "-"], capture_output=True, text=True)
    return [float(t) for t in re.findall(r"pts_time:([0-9.]+)", p.stderr)]


def auto_clips(src: Path, beat_dur: float, head_skip: float = 5.0,
               tail_skip: float = 15.0, clip_len: float = 4.0) -> list[tuple[float, float]]:
    """Pick short clips spread across the video, preferring its own scene cuts.
    head_skip/tail_skip exclude the intro (producer tags/"Produced by") and the
    outro (end credits, subscribe screens) so that text doesn't land in the video."""
    src_dur = duration(src)
    length = min(clip_len, src_dur)  # one bar when beat-sync is on, stays under the 5s cap
    lo, hi = max(head_skip, 0.0), src_dur - length - max(tail_skip, 0.0)
    if hi <= lo:  # margins would eat the whole clip (short video) — use the full range
        lo, hi = 0.0, max(src_dur - length, 0.0)
    n = max(3, min(12, round(beat_dur / length)))
    starts = [t for t in scene_starts(src) if lo <= t <= hi]
    if len(starts) >= n:  # sample n cuts evenly across the usable window
        starts = sorted({starts[round(i * (len(starts) - 1) / (n - 1))] for i in range(n)})
    else:  # few/no scene changes — fall back to evenly spaced starts in the window
        step = (hi - lo) / max(n - 1, 1)
        starts = [lo + i * step for i in range(n)]
    return [(round(s, 2), round(s + length, 2)) for s in starts]


def best_window(beat: Path, length: float) -> float:
    """Start time (s) of the highest-energy `length`-second window — usually the
    drop/hook. Used to cut a Short teaser from the loudest part of the beat."""
    import librosa
    import numpy as np
    total = duration(beat)
    if total <= length + 0.5:
        return 0.0
    wav = beat.parent / "beat_energy.wav"
    run(["ffmpeg", "-y", "-i", str(beat), "-ac", "1", "-ar", "22050", "-t", "600", str(wav)])
    y, sr = librosa.load(str(wav), sr=22050, mono=True)
    hop = 512
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    fps = sr / hop
    wlen = int(length * fps)
    if wlen >= len(rms) or wlen < 1:
        return 0.0
    csum = np.cumsum(np.insert(rms, 0, 0.0))  # prefix sum -> O(n) sliding energy
    start = int(np.argmax(csum[wlen:] - csum[:-wlen])) / fps
    return round(min(start, total - length), 2)


def _label(score: int) -> str:
    return ("Excellent" if score >= 85 else "Good" if score >= 70
            else "Needs work" if score >= 50 else "Poor")


def rate_thumbnail(path: Path) -> dict:
    """Score a thumbnail on hard specs (size/ratio/filesize) + measurable click-quality
    (bright, punchy, sharp). Honest heuristics — real image signals, NOT a CTR prediction.
    Thresholds are tuned knobs; adjust if your channel's winners disagree."""
    from PIL import Image
    import numpy as np
    im = Image.open(path).convert("RGB")
    w, h = im.size
    size_mb = path.stat().st_size / 1e6
    small = im.resize((640, max(1, round(640 * h / w)))) if w > 640 else im  # scale-stable metrics
    a = np.asarray(small, dtype=np.float64)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    brightness, contrast = float(luma.mean()), float(luma.std())
    rg, yb = r - g, 0.5 * (r + g) - b  # Hasler-Süsstrunk colorfulness
    colorfulness = float(np.hypot(rg.std(), yb.std()) + 0.3 * np.hypot(rg.mean(), yb.mean()))
    lap = (luma[1:-1, 2:] + luma[1:-1, :-2] + luma[2:, 1:-1] + luma[:-2, 1:-1]
           - 4 * luma[1:-1, 1:-1])  # variance of Laplacian = focus/sharpness
    sharpness = float(lap.var())

    checks = []
    def add(label, state, detail, tip=""):
        checks.append({"label": label, "state": state, "detail": detail, "tip": tip})
    ar = w / h if h else 0
    add("Resolution", "good" if w >= 1280 and h >= 720 else "warn", f"{w}×{h}",
        "" if w >= 1280 and h >= 720 else "Use at least 1280×720.")
    add("Aspect ratio", "good" if abs(ar - 16 / 9) < 0.06 else "warn", f"{ar:.2f}:1",
        "" if abs(ar - 16 / 9) < 0.06 else "YouTube thumbnails are 16:9 (1.78:1).")
    add("File size", "good" if size_mb < 2 else "warn", f"{size_mb:.1f} MB",
        "" if size_mb < 2 else "Over 2MB — we auto-shrink it on upload.")
    add("Brightness", "good" if 70 <= brightness <= 210 else "warn", f"{brightness:.0f}/255",
        "" if 70 <= brightness <= 210 else
        ("Dark thumbnails get fewer clicks — brighten it." if brightness < 70 else "Overexposed — pull it down."))
    add("Contrast", "good" if contrast >= 45 else "warn", f"{contrast:.0f}",
        "" if contrast >= 45 else "Flat — add tonal range so it pops in the feed.")
    add("Colorfulness", "good" if colorfulness >= 25 else "warn", f"{colorfulness:.0f}",
        "" if colorfulness >= 25 else "Dull — punchier colors stand out in search.")
    add("Sharpness", "good" if sharpness >= 40 else "warn", f"{sharpness:.0f}",
        "" if sharpness >= 40 else "Looks soft/blurry — use a crisp image.")

    pts = {"good": 1.0, "warn": 0.5, "bad": 0.0}
    score = round(100 * sum(pts[c["state"]] for c in checks) / len(checks))
    return {"score": score, "label": _label(score), "checks": checks,
            "metrics": {"brightness": round(brightness), "contrast": round(contrast),
                        "colorfulness": round(colorfulness), "sharpness": round(sharpness)}}


def normalize(src: Path, dst: Path, vf_extra: str = "", start: Optional[float] = None,
              length: Optional[float] = None, vf_base: str = VF) -> None:
    """Re-encode an image, video, or video slice into a uniform silent segment."""
    pre = []
    if src.suffix.lower() in IMAGE_EXTS:
        pre = ["-loop", "1", "-t", str(length or IMAGE_SECONDS)]
    else:
        if start is not None:
            pre += ["-ss", str(start)]
        if length is not None:
            pre += ["-t", str(length)]
    vf = vf_base + ("," + vf_extra if vf_extra else "")
    # ultrafast/crf23: YouTube re-encodes uploads anyway, so spend nothing on finesse
    run(["ffmpeg", "-y", *pre, "-i", str(src), "-an", "-vf", vf,
         "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", str(dst)])


def build(beat: Path, media: list[Path], out: Path, vf_extra: str = "",
          source: Optional[Path] = None, clips: Optional[list[tuple[float, float]]] = None,
          fmt: str = "landscape", seg_len: Optional[float] = None,
          first_extra: float = 0.0, overlay_text: str = "", visualizer: str = "none",
          overlay_font: Optional[str] = None) -> None:
    beat_dur = duration(beat)
    work = beat.parent
    vf_base = base_vf(fmt)
    fw, fh, _ = FORMATS[fmt]
    segs = []
    if clips:
        for i, (start, end) in enumerate(clips):
            seg = work / f"seg{i}.mp4"
            length = min(end - start, seg_len) if seg_len else end - start
            normalize(source, seg, vf_extra, start=start, length=length, vf_base=vf_base)
            segs.append((seg, duration(seg)))
    for i, m in enumerate(media):
        seg = work / f"m{i}.mp4"
        normalize(m, seg, vf_extra, length=seg_len, vf_base=vf_base)
        segs.append((seg, duration(seg)))

    # cycle through the segments until we cover the beat, then hard-cut at beat end
    concat = work / "list.txt"
    lines, total, i = [], 0.0, 0
    if first_extra > 0:  # extend the opening shot so later cuts land on the beat grid
        first = work / "seg_first.mp4"
        if clips:
            s0, e0 = clips[0]
            length = (min(e0 - s0, seg_len) if seg_len else e0 - s0) + first_extra
            normalize(source, first, vf_extra, start=s0, length=length, vf_base=vf_base)
        else:
            normalize(media[0], first, vf_extra, length=(seg_len or IMAGE_SECONDS) + first_extra,
                      vf_base=vf_base)
        lines.append(f"file '{first}'")
        total += duration(first)
        i = 1
    while total < beat_dur:
        seg, d = segs[i % len(segs)]
        lines.append(f"file '{seg}'")
        total += d
        i += 1
    concat.write_text("\n".join(lines) + "\n")

    # Final mux. Stream-copy the video unless a tag or visualizer needs a re-encode.
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-i", str(beat)]
    overlays, last = [], "0:v"
    if visualizer in VISUALIZERS:
        strip = fh // 14
        gen = VISUALIZERS[visualizer].format(w=fw, s=strip, fps=FPS)
        # hue=s=0 forces monochrome — showfreqs rainbow-colors bins and ignores `colors`
        overlays.append(f"[1:a]{gen},hue=s=0,format=yuva420p,colorchannelmixer=aa=0.3[vz]")
        # sit the thin line a little above the very bottom edge
        overlays.append(f"[{last}][vz]overlay=0:{fh - strip - fh // 22}[vv]")
        last = "vv"
    if overlay_text and FONT:
        tag = work / "tag.png"
        make_tag_png(overlay_text, tag, fw, fh, overlay_font)
        cmd += ["-i", str(tag)]
        overlays.append(f"[{last}][2:v]overlay=0:0[vt]")
        last = "vt"
    if overlays:
        cmd += ["-filter_complex", ";".join(overlays), "-map", f"[{last}]", "-map", "1:a",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
    else:
        cmd += ["-map", "0:v", "-map", "1:a", "-c:v", "copy"]
    cmd += ["-c:a", "aac", "-b:a", "192k", "-t", str(beat_dur), "-movflags", "+faststart", str(out)]
    run(cmd)


@app.post("/make")
async def make(beat: UploadFile = File(...), media: list[UploadFile] = File(default=[]),
               source: Optional[UploadFile] = File(default=None), clips: str = Form(default=""),
               filter: str = Form(default="none"), youtube: str = Form(default="off"),
               title: str = Form(default=""), description: str = Form(default=""),
               tags: str = Form(default=""), publish_at: str = Form(default=""),
               thumbnail: Optional[UploadFile] = File(default=None),
               thumb_filter: str = Form(default="none"),
               head_skip: float = Form(default=5.0), tail_skip: float = Form(default=15.0),
               fmt: str = Form(default="landscape"), beat_sync: str = Form(default="on"),
               overlay_text: str = Form(default=""), visualizer: str = Form(default="none"),
               overlay_font: str = Form(default=""),
               also_short: str = Form(default="off"), short_len: float = Form(default=30.0)):
    if fmt not in FORMATS:
        raise HTTPException(400, f"format must be one of {list(FORMATS)}")
    if visualizer not in ("none", *VISUALIZERS):
        raise HTTPException(400, f"visualizer must be none|{'|'.join(VISUALIZERS)}")
    if overlay_font and overlay_font not in FONTS:
        raise HTTPException(400, f"font must be one of {list(FONTS)}")
    vf_extra = FILTERS.get(filter)
    if vf_extra is None:
        raise HTTPException(400, f"unknown filter, pick one of {list(FILTERS)}")
    thumb_vf = FILTERS.get(thumb_filter)
    if thumb_vf is None:
        raise HTTPException(400, f"unknown thumbnail filter, pick one of {list(FILTERS)}")
    if youtube not in ("off", "private", "unlisted", "public"):
        raise HTTPException(400, "youtube must be off|private|unlisted|public")
    if publish_at:
        try:
            when = datetime.fromisoformat(publish_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "bad publish time")
        if when <= datetime.now(timezone.utc):
            raise HTTPException(400, "schedule time must be in the future")
    auto = clips == "auto"
    clip_list: list[tuple[float, float]] = []
    if clips and not auto:
        try:
            clip_list = [(float(c["start"]), float(c["end"])) for c in json.loads(clips)]
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            raise HTTPException(400, "clips must be JSON like [{\"start\":1,\"end\":4}]")
        for start, end in clip_list:
            if start < 0 or end <= start:
                raise HTTPException(400, f"bad clip range {start}-{end}")
            if end - start > MAX_CLIP_SECONDS + 0.01:  # small tolerance for float rounding
                raise HTTPException(400, f"clips are capped at {MAX_CLIP_SECONDS}s to stay copyright-safe")
    if (clip_list or auto) and source is None:
        raise HTTPException(400, "clips given but no source video")
    if not clip_list and not auto and not media:
        raise HTTPException(400, "upload media files or select clips from a source video")

    work = Path(tempfile.mkdtemp(prefix="beatvideo_"))
    try:
        beat_path = work / ("beat" + Path(beat.filename).suffix)
        beat_path.write_bytes(await beat.read())
        seg_len, first_extra, bpm = (detect_beats(beat_path) if beat_sync == "on"
                                     else (None, 0.0, 0.0))
        media_paths = []
        for i, f in enumerate(media):
            p = work / f"in{i}{Path(f.filename).suffix.lower()}"
            p.write_bytes(await f.read())
            media_paths.append(p)
        source_path = None
        if clip_list or auto:
            source_path = work / ("src" + Path(source.filename).suffix.lower())
            source_path.write_bytes(await source.read())
        if auto:
            clip_list = auto_clips(source_path, duration(beat_path), head_skip, tail_skip,
                                   clip_len=seg_len or 4.0)
        thumb_path = None
        if thumbnail is not None and youtube != "off":
            raw = work / ("thumb_raw" + Path(thumbnail.filename).suffix.lower())
            raw.write_bytes(await thumbnail.read())
            # always re-encode to a 1280x720 JPEG so it's well under YouTube's 2MB cap;
            # apply the color filter in the same pass
            tvf = ("scale=1280:720:force_original_aspect_ratio=decrease,"
                   "pad=1280:720:(ow-iw)/2:(oh-ih)/2")
            if thumb_vf:
                tvf += "," + thumb_vf
            thumb_path = work / "thumb.jpg"
            run(["ffmpeg", "-y", "-i", str(raw), "-vf", tvf, "-q:v", "3", str(thumb_path)])
        out = work / "beat_video.mp4"
        build(beat_path, media_paths, out, vf_extra, source_path, clip_list, fmt,
              seg_len=seg_len, first_extra=first_extra,
              overlay_text=overlay_text.strip()[:60], visualizer=visualizer,
              overlay_font=FONTS.get(overlay_font))
        if youtube != "off":
            import youtube as yt  # local-only; import here so Railway never needs the deps
            tag_list = [t.strip() for t in tags.split(",") if t.strip()]
            try:
                video_id = yt.upload(out, title or "BeatVideo", description=description,
                                     privacy=youtube, tags=tag_list, publish_at=publish_at or None)
            except RuntimeError as e:
                raise HTTPException(400, str(e))  # e.g. "not connected — run youtube_auth.py"
            thumb_note = ""
            if thumb_path:
                try:
                    yt.set_thumbnail(video_id, thumb_path)
                except RuntimeError as e:
                    thumb_note = str(e)  # keep the video; just report the thumbnail didn't stick
            # optional vertical Short that links back to the full video (audience funnel)
            short_url, short_note = "", ""
            if also_short == "on":
                try:
                    slen = min(max(short_len, 15.0), 60.0)  # YouTube Shorts must be <= 60s
                    s_start = best_window(beat_path, slen)
                    short_beat = work / ("short_beat" + Path(beat.filename).suffix)
                    run(["ffmpeg", "-y", "-ss", str(s_start), "-t", str(slen),
                         "-i", str(beat_path), "-c", "copy", str(short_beat)])
                    s_seg, s_first, _ = (detect_beats(short_beat) if beat_sync == "on"
                                         else (None, 0.0, 0.0))
                    s_clips = clip_list
                    if auto:  # re-pick clips to fill the shorter beat
                        s_clips = auto_clips(source_path, duration(short_beat), head_skip,
                                             tail_skip, clip_len=s_seg or 4.0)
                    short_out = work / "short.mp4"
                    build(short_beat, media_paths, short_out, vf_extra, source_path, s_clips,
                          "vertical", seg_len=s_seg, first_extra=s_first,
                          overlay_text=overlay_text.strip()[:60], visualizer=visualizer,
                          overlay_font=FONTS.get(overlay_font))
                    s_title = (title or "BeatVideo")
                    if "#short" not in s_title.lower():
                        s_title = s_title[:88] + " #Shorts"
                    s_desc = f"🔊 Full beat 👇\nhttps://youtu.be/{video_id}\n\n{description}"
                    short_id = yt.upload(short_out, s_title, description=s_desc, privacy=youtube,
                                         tags=tag_list, publish_at=publish_at or None)
                    short_url = f"https://youtu.be/{short_id}"
                except Exception as e:
                    short_note = f"Short skipped: {e}"  # never lose the main upload
            return {"youtube_url": f"https://youtu.be/{video_id}", "privacy": youtube,
                    "publish_at": publish_at, "thumbnail_error": thumb_note, "bpm": bpm,
                    "short_url": short_url, "short_error": short_note}
    except Exception:
        shutil.rmtree(work, ignore_errors=True)
        raise
    finally:
        if youtube != "off":
            shutil.rmtree(work, ignore_errors=True)
    headers = {"X-Beat": f"{bpm} BPM, cut every {seg_len}s"} if bpm else {}
    return FileResponse(out, media_type="video/mp4", filename="beat_video.mp4", headers=headers,
                        background=BackgroundTask(shutil.rmtree, work, ignore_errors=True))


@app.get("/suggest")
def suggest(q: str) -> list:
    """Live YouTube search autocomplete for `q` — real, demand-ordered completions.
    Google's suggest endpoint (ds=yt) returns ["q",[suggestions...]]; it sends no CORS
    headers so the browser can't call it directly, hence this thin server proxy."""
    q = q.strip()[:80]
    if not q:
        return []
    url = ("https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=en&q="
           + quote(q))
    try:
        with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=6) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
        return data[1] if len(data) > 1 and isinstance(data[1], list) else []
    except Exception:
        return []  # research is a bonus — never break the generator if the pull fails


@app.post("/thumb_score")
async def thumb_score(thumbnail: UploadFile = File(...)):
    """Rate an uploaded thumbnail (specs + click-quality). See rate_thumbnail()."""
    raw = await thumbnail.read()
    if not raw:
        raise HTTPException(400, "empty thumbnail")
    work = Path(tempfile.mkdtemp(prefix="thumb_"))
    try:
        p = work / ("t" + Path(thumbnail.filename or "t.jpg").suffix)
        p.write_bytes(raw)
        try:
            return rate_thumbnail(p)
        except Exception:
            raise HTTPException(400, "couldn't read that image")
    finally:
        shutil.rmtree(work, ignore_errors=True)


@app.get("/youtube/videos")
def youtube_videos():
    import youtube as yt  # local-only
    try:
        return yt.list_recent()
    except RuntimeError as e:
        raise HTTPException(400, str(e))


@app.post("/batch")
async def batch(beats: list[UploadFile] = File(...), covers: list[UploadFile] = File(...),
                titles: str = Form(default="[]"), schedule: str = Form(default="[]"),
                descriptions: str = Form(default="[]"),
                fmt: str = Form(default="landscape"), filter: str = Form(default="none"),
                overlay_text: str = Form(default=""), overlay_font: str = Form(default=""),
                visualizer: str = Form(default="none"), description: str = Form(default=""),
                tags: str = Form(default="")):
    """Render one video per beat (paired with a cover image by order) and upload each to
    YouTube, scheduled at its own publishAt so YouTube auto-publishes them over time."""
    import youtube as yt  # local-only
    if fmt not in FORMATS:
        raise HTTPException(400, f"format must be one of {list(FORMATS)}")
    vf_extra = FILTERS.get(filter) or ""
    if visualizer not in ("none", *VISUALIZERS):
        raise HTTPException(400, "bad visualizer")
    try:
        title_list, sched_list, desc_list = (json.loads(titles), json.loads(schedule),
                                             json.loads(descriptions))
    except ValueError:
        raise HTTPException(400, "titles/schedule/descriptions must be JSON arrays")
    if not beats or not covers:
        raise HTTPException(400, "need at least one beat and one cover")
    font_path, tag_list = FONTS.get(overlay_font), [t.strip() for t in tags.split(",") if t.strip()]
    now = datetime.now(timezone.utc)
    # read every upload up front — an UploadFile stream can only be read once, and we reuse covers
    beat_blobs = [(Path(b.filename).stem, Path(b.filename).suffix, await b.read()) for b in beats]
    cover_blobs = [(Path(c.filename).suffix.lower(), await c.read()) for c in covers]

    results = []
    for i, (stem, suffix, blob) in enumerate(beat_blobs):
        title = (title_list[i] if i < len(title_list) and title_list[i] else stem) or "BeatVideo"
        pub = sched_list[i] if i < len(sched_list) else ""
        work = Path(tempfile.mkdtemp(prefix="beatvideo_batch_"))
        try:
            if pub:
                when = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                if when <= now:
                    raise ValueError("schedule time is in the past")
            beat_path = work / ("beat" + suffix)
            beat_path.write_bytes(blob)
            csuf, cblob = cover_blobs[i] if i < len(cover_blobs) else cover_blobs[-1]
            cover_path = work / ("cover" + csuf)
            cover_path.write_bytes(cblob)
            out = work / "beat_video.mp4"
            build(beat_path, [cover_path], out, vf_extra, fmt=fmt,
                  overlay_text=overlay_text.strip()[:60], visualizer=visualizer,
                  overlay_font=font_path)
            # per-video description if the row sent one, else the shared default; {title} still expands
            desc_src = desc_list[i] if i < len(desc_list) else description
            desc = (desc_src or "").replace("{title}", title)
            video_id = yt.upload(out, title, description=desc, privacy="private",
                                 tags=tag_list, publish_at=pub or None)
            results.append({"title": title, "youtube_url": f"https://youtu.be/{video_id}",
                            "publish_at": pub})
        except Exception as e:
            results.append({"title": title, "error": str(e)})
        finally:
            shutil.rmtree(work, ignore_errors=True)
    return {"results": results}


@app.get("/", response_class=HTMLResponse)
def index():
    font_opts = "".join(f'<option value="{n}">{n}</option>' for n in FONTS)
    return _INDEX.replace("__FONT_OPTIONS__", font_opts)


_INDEX = """<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BeatVideo</title>
<style>
  body{font-family:system-ui;max-width:560px;margin:40px auto;padding:0 16px;background:#111;color:#eee}
  h1{font-size:1.5rem} .card{background:#1c1c1e;border-radius:12px;padding:20px;margin:16px 0}
  label{display:block;margin-bottom:8px;font-weight:600}
  input[type=file]{display:block;width:100%;color:#aaa;margin-top:8px;font-weight:400}
  button{width:100%;padding:14px;border:0;border-radius:10px;background:#e0245e;color:#fff;
         font-size:1rem;font-weight:700;cursor:pointer} button:disabled{opacity:.5}
  button.mini{width:auto;padding:8px 12px;font-size:.85rem;font-weight:600;background:#333}
  .row{display:flex;gap:8px} .row button{flex:1}
  select,#ytdetails input,#ytdetails textarea{width:100%;padding:10px;margin-top:8px;border-radius:8px;
    background:#2a2a2c;color:#eee;border:1px solid #444;box-sizing:border-box;font:inherit}
  #ytdetails textarea{resize:vertical}
  ol{padding-left:20px} li{margin:6px 0}
  #msg{margin-top:12px;color:#aaa}
  #tabs{display:flex;gap:8px;margin:14px 0 18px}
  .tab{flex:1;background:#1c1c1e;color:#aaa;border:1px solid #333;padding:12px;font-size:.95rem}
  .tab.active{background:#e0245e;color:#fff;border-color:#e0245e}
  details.card>summary{cursor:pointer;font-weight:600;list-style:none;display:flex;
    justify-content:space-between;align-items:center}
  details.card>summary::-webkit-details-marker{display:none}
  details.card>summary::after{content:'▸';color:#888;font-weight:400}
  details.card[open]>summary::after{content:'▾'}
  .sub{margin-top:14px} .sub>label:first-child{margin-top:0}
  .hint{color:#888;font-size:.8rem;margin-top:6px;font-weight:400}
  summary .hint{display:inline;margin:0}
  label.chk{font-weight:400;margin-top:12px;display:block}
  label.chk input{width:auto;margin-right:6px}
</style>
<h1>🎬 BeatVideo</h1>
<div id="tabs">
  <button type="button" class="tab active" data-pane="single">🎬 Single video</button>
  <button type="button" class="tab" data-pane="batch">📅 Batch schedule</button>
</div>
<datalist id="pastList"></datalist>

<details class="card">
  <summary>🎨 Look &amp; style <span class="hint">— format, filter, tag, visualizer</span></summary>
  <div class="sub">
    <label>Video format</label>
    <select id="fmt">
      <option value="landscape">YouTube — landscape 16:9 (1920×1080)</option>
      <option value="vertical">Reels / TikTok / Shorts — vertical 9:16 (1080×1920)</option>
      <option value="square">Instagram feed — square 1:1 (1080×1080)</option>
    </select>
    <div class="hint">Vertical &amp; square fill the frame (sides cropped) so there are no black bars.</div>
    <label style="margin-top:14px">Filter</label>
    <select id="filter">
      <option value="none">None</option><option value="bw">Black &amp; white</option>
      <option value="warm">Warm</option><option value="cool">Cool</option>
      <option value="punch">Punchy (contrast + saturation)</option><option value="vhs">VHS / vintage</option>
    </select>
    <label class="chk"><input type="checkbox" id="beatSync" checked>🥁 Cut clips on the beat (detects BPM)</label>
    <label style="margin-top:14px">Producer tag / overlay text</label>
    <input type="text" id="overlayText" placeholder="e.g. PROD. BY OSEABHI">
    <label style="margin-top:14px">Tag font</label>
    <select id="overlayFont">__FONT_OPTIONS__</select>
    <label style="margin-top:14px">Audio visualizer</label>
    <select id="visualizer">
      <option value="none">None</option>
      <option value="waveform">Waveform</option>
      <option value="bars">Frequency bars</option>
    </select>
    <div class="hint">Tag sits bottom-right; visualizer animates along the bottom. Both are remembered.</div>
  </div>
</details>

<details class="card">
  <summary>🚀 Type-beat SEO <span class="hint">— title &amp; tags people actually search</span></summary>
  <div class="sub">
    <label>Artist(s) to target <span class="hint">(comma-separated, first is primary)</span></label>
    <input type="text" id="seoArtist" placeholder="e.g. Drake, Rema">
    <label style="margin-top:12px">Genre / vibe</label>
    <input type="text" id="seoGenre" placeholder="e.g. Afrobeats, Trap, Drill">
    <label style="margin-top:12px">Song / mood name <span class="hint">(optional)</span></label>
    <input type="text" id="seoSong" placeholder="e.g. Midnight">
    <div class="row" style="margin-top:12px">
      <label style="font-weight:400;flex:1">BPM <input type="text" id="seoBpm" placeholder="140" style="width:100%"></label>
      <label style="font-weight:400;flex:1">Key <input type="text" id="seoKey" placeholder="C min" style="width:100%"></label>
    </div>
    <button type="button" id="seoGo" class="mini" style="margin-top:12px">✨ Generate from live searches</button>
    <div id="seoMsg" class="hint"></div>
    <div id="seoSuggest" style="margin-top:6px"></div>
    <div class="hint">Pulls <b>live YouTube autocomplete</b> for your artist/genre — the real,
      demand-ordered searches — uses them as tags, and builds the proven
      <b>[FREE] "Song" | Artist Type Beat | Genre Type Beat YEAR</b> title. Drops both into
      Single and Batch. The chips are what people actually type — retarget a less crowded one if the top is saturated.</div>
  </div>
</details>

<div id="singlePane">
<p class="hint">Upload a beat, then pick clips from a music video and/or add pictures. Drag &amp; drop works too.</p>
<div class="card"><label>Beat (mp3 / wav)<input type="file" id="beat" accept="audio/*"></label>
  <audio id="beatAudio" controls style="width:100%;margin-top:10px;display:none"></audio></div>
<div class="card">
  <label>Music video (clips are cut from this)<input type="file" id="source" accept="video/*"></label>
  <video id="player" controls playsinline style="width:100%;margin-top:10px;border-radius:8px;display:none"></video>
  <div id="pickrow" style="display:none;margin-top:10px">
    <label class="chk"><input type="checkbox" id="autoPick" checked>✨ Auto-pick clips (uses the video's scene cuts)</label>
    <div id="autorow" style="margin-top:8px">
      <label style="font-weight:400">Skip intro <input type="number" id="headSkip" value="5" min="0" style="width:64px"> s</label>
      <label style="font-weight:400;margin-left:14px">Skip outro <input type="number" id="tailSkip" value="15" min="0" style="width:64px"> s</label>
      <div class="hint">Keeps "Produced by" intros and end-credit screens out of the clips.</div>
    </div>
    <div class="row" id="manualrow">
      <button class="mini" id="markIn">⬇ Mark start</button>
      <button class="mini" id="markOut">⬆ Mark end + add clip</button>
    </div>
    <div id="marks" style="color:#aaa;margin-top:8px">Play the video and mark clip start/end.</div>
    <ol id="cliplist"></ol>
  </div>
</div>
<div class="card"><label>Extra pictures / clips (optional)
  <input type="file" id="media" accept="image/*,video/*" multiple></label></div>
<div class="card"><label>Upload to YouTube</label>
  <select id="youtube">
    <option value="off">No — just download the file</option>
    <option value="private">Yes — Private (only you)</option>
    <option value="unlisted">Yes — Unlisted (link only)</option>
    <option value="public">Yes — Public</option>
  </select>
  <div id="ytdetails" style="display:none">
    <input id="reuseFrom" class="reuseInp" list="pastList" placeholder="🔎 Copy details from a past video (type to search)…">
    <input type="text" id="title" placeholder="Video title">
    <textarea id="description" rows="3" placeholder="Description"></textarea>
    <input type="text" id="tags" placeholder="Tags, comma separated (afrobeats, type beat, free beat)">
    <div style="margin-top:14px"><b style="font-size:.85rem">📊 SEO score</b>
      <span class="hint">— live grade of your title, description &amp; tags</span></div>
    <div id="seoScoreBox" style="margin-top:6px"></div>
    <label style="font-weight:400;margin-top:12px">Custom thumbnail (optional, JPG/PNG under 2MB)
      <input type="file" id="thumbnail" accept="image/*"></label>
    <div id="thumbScoreBox" style="margin-top:6px"></div>
    <select id="thumbFilter">
      <option value="none">Thumbnail filter: None</option>
      <option value="bw">Thumbnail: Black &amp; white</option>
      <option value="warm">Thumbnail: Warm</option><option value="cool">Thumbnail: Cool</option>
      <option value="punch">Thumbnail: Punchy</option><option value="vhs">Thumbnail: VHS / vintage</option>
    </select>
    <label style="font-weight:400;margin-top:10px">Schedule publish (optional)
      <input type="datetime-local" id="scheduleAt"></label>
    <div style="color:#888;font-size:.8rem;margin-top:6px">If set, the video uploads private and
      goes <b>Public</b> automatically at that time. Leave blank to publish now.
      Title/description/tags are remembered for next time.</div>
    <label class="chk" style="margin-top:14px"><input type="checkbox" id="alsoShort">🎬 Also make a vertical
      <b>&nbsp;Short</b>&nbsp; that links to this video (funnels viewers to the full beat)</label>
    <label id="shortLenRow" style="font-weight:400;margin-top:6px;display:none">Short length
      <input type="number" id="shortLen" value="30" min="15" max="60" style="width:64px"> s
      <span class="hint">cut from the loudest part (the drop). Uploads at the same privacy/schedule.</span></label>
  </div>
</div>
<button id="go">Make video</button>
<div id="msg"></div>
</div><!-- /singlePane -->

<div id="batchPane" hidden>
<div class="card">
  <div class="hint" style="margin:0 0 10px">Drop several beats + cover images (paired in order; one cover
    works for all). Each becomes a video, uploaded Private and set to go Public on its date. Uses the
    <b>Look &amp; style</b> section above.</div>
  <label style="font-weight:400">Beats (audio, multiple)<input type="file" id="batchBeats" accept="audio/*" multiple></label>
  <label style="font-weight:400;margin-top:8px">Cover images<input type="file" id="batchCovers" accept="image/*" multiple></label>
  <input type="text" id="batchTitle" placeholder="Default title for every video — use {name} for the file name (blank = file name)"
    style="width:100%;margin-top:10px;padding:10px;border-radius:8px;background:#2a2a2c;color:#eee;border:1px solid #444;box-sizing:border-box">
  <textarea id="batchDescription" rows="3" placeholder="Default description for every video — use {title} to insert each beat's title"
    style="width:100%;margin-top:8px;padding:10px;border-radius:8px;background:#2a2a2c;color:#eee;border:1px solid #444;box-sizing:border-box;font:inherit;resize:vertical"></textarea>
  <input type="text" id="batchTags" placeholder="Tags for all (afrobeats, type beat, free beat)"
    style="width:100%;margin-top:8px;padding:10px;border-radius:8px;background:#2a2a2c;color:#eee;border:1px solid #444;box-sizing:border-box">
  <input id="batchReuse" class="reuseInp" list="pastList" placeholder="🔎 Copy title, description &amp; tags from a past video (type to search)…"
    style="width:100%;margin-top:8px;padding:10px;border-radius:8px;background:#2a2a2c;color:#eee;border:1px solid #444;box-sizing:border-box">
  <button type="button" id="batchApplyDesc" class="mini" style="margin-top:8px">↻ Apply title &amp; description to every video below</button>
  <div style="color:#888;font-size:.8rem;margin-top:6px">Each video's <b>title</b> and <b>description</b> are
    editable per row below — the fields above are the defaults. Description &amp; tags are remembered.</div>
  <label style="font-weight:400;margin-top:10px">Posting rhythm
    <select id="batchCadence" style="width:100%;padding:8px;border-radius:8px;background:#2a2a2c;color:#eee;border:1px solid #444;box-sizing:border-box;margin-top:6px">
      <option value="1">Daily</option>
      <option value="2" selected>Every 2 days</option>
      <option value="3">Every 3 days</option>
      <option value="7">Weekly</option>
    </select></label>
  <div class="hint">A steady cadence keeps you in the algorithm — pick one and the dates fill in.</div>
  <div class="row" style="margin-top:10px">
    <label style="font-weight:400;flex:2">Start date/time<input type="datetime-local" id="batchStart" style="width:100%;padding:8px;border-radius:8px;background:#2a2a2c;color:#eee;border:1px solid #444;box-sizing:border-box"></label>
    <label style="font-weight:400;flex:1">Every<input type="number" id="batchInterval" value="2" min="0" step="1" style="width:100%;padding:8px;border-radius:8px;background:#2a2a2c;color:#eee;border:1px solid #444;box-sizing:border-box"> day(s)</label>
  </div>
  <div id="batchSummary" class="hint" style="margin-top:8px"></div>
  <div id="batchRows" style="margin-top:10px"></div>
  <button id="batchGo" style="margin-top:12px;background:#1a7f4b">📤 Render &amp; schedule batch</button>
  <div id="batchMsg" style="margin-top:10px;color:#aaa"></div>
</div>
</div><!-- /batchPane -->
<script>
const $ = id => document.getElementById(id);
// Single / Batch tabs — toggle which pane shows; the shared style section stays visible
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  $('singlePane').hidden = t.dataset.pane !== 'single';
  $('batchPane').hidden = t.dataset.pane !== 'batch';
});
// preview the chosen beat inline
$('beat').addEventListener('change', () => {
  if ($('beat').files[0]) { $('beatAudio').src = URL.createObjectURL($('beat').files[0]);
    $('beatAudio').style.display = 'block'; }
});
const beat = $('beat'), source = $('source'), media = $('media'), player = $('player'),
      pickrow = $('pickrow'), marks = $('marks'), cliplist = $('cliplist'),
      markIn = $('markIn'), markOut = $('markOut'), go = $('go'),
      filterSel = $('filter'), msg = $('msg'), youtubeSel = $('youtube'),
      ytdetails = $('ytdetails'), title = $('title'), description = $('description'), tags = $('tags'),
      reuseFrom = $('reuseFrom'), scheduleAt = $('scheduleAt');

// can't schedule in the past
{ const n = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); scheduleAt.min = n.toISOString().slice(0, 16); }

// remember YouTube details across sessions; show the fields only when uploading
const YT_FIELDS = {youtube: youtubeSel, title, description, tags};
try {
  const saved = JSON.parse(localStorage.getItem('beatvideo_yt') || '{}');
  for (const k in YT_FIELDS) if (saved[k] != null) YT_FIELDS[k].value = saved[k];
} catch (e) {}
function saveYt() {
  const data = {};
  for (const k in YT_FIELDS) data[k] = YT_FIELDS[k].value;
  localStorage.setItem('beatvideo_yt', JSON.stringify(data));
}
// remember the producer tag (it's usually the same every video)
$('overlayText').value = localStorage.getItem('beatvideo_tag') || '';
$('overlayText').addEventListener('input', () => localStorage.setItem('beatvideo_tag', $('overlayText').value));
if (localStorage.getItem('beatvideo_font')) $('overlayFont').value = localStorage.getItem('beatvideo_font');
$('overlayFont').addEventListener('change', () => localStorage.setItem('beatvideo_font', $('overlayFont').value));

function syncYt() {
  const show = youtubeSel.value !== 'off';
  ytdetails.style.display = show ? 'block' : 'none';
  if (show) loadPast();
}
for (const el of Object.values(YT_FIELDS)) el.addEventListener('input', () => { saveYt(); syncYt(); });

// Reuse a past video's details. Every <input class="reuseInp"> is a search box backed by the
// shared <datalist id="pastList"> — type to filter all channel uploads, pick one to apply.
let pastVideos = [], loadedPast = false, titleMap = new Map();
function fillDatalist() {
  const dl = $('pastList'); dl.innerHTML = ''; titleMap = new Map();
  pastVideos.forEach(v => {
    const label = v.title || '(untitled)';
    const o = document.createElement('option'); o.value = label; dl.appendChild(o);
    titleMap.set(label, v);  // dup titles: last wins (cosmetic only)
  });
}
async function loadPast() {
  if (loadedPast) return;
  loadedPast = true;
  try {
    const r = await fetch('/youtube/videos');
    if (!r.ok) throw new Error(await r.text());
    pastVideos = await r.json();
    fillDatalist();
  } catch (e) { loadedPast = false; }  // let it retry next focus
}
const pickedVideo = inp => titleMap.get(inp.value.trim());
document.querySelectorAll('.reuseInp').forEach(inp => inp.addEventListener('focus', loadPast));
reuseFrom.addEventListener('change', () => {
  const v = pickedVideo(reuseFrom); if (!v) return;
  title.value = v.title; description.value = v.description; tags.value = (v.tags || []).join(', ');
  saveYt(); reuseFrom.value = '';  // reset the search box
});
$('batchReuse').addEventListener('change', () => {
  const v = pickedVideo($('batchReuse')); if (!v) return;
  $('batchTitle').value = v.title; $('batchDescription').value = v.description;
  $('batchTags').value = (v.tags || []).join(', ');
  [$('batchTitle'), $('batchDescription'), $('batchTags')].forEach(el => el.dispatchEvent(new Event('input')));
  $('batchReuse').value = '';
});
syncYt();

// ---- Type-beat SEO: pull LIVE YouTube autocomplete for real demand-ordered tags,
// fall back to a built set if the pull fails, drop title+tags into Single & Batch. ----
function fallbackTags(artists, genre, year, bpm, key) {  // offline / blocked path
  const s = [];
  artists.forEach(a => { const l = a.toLowerCase();
    ['{} type beat', '{} type beat ' + year, 'free {} type beat', '{} instrumental', '{} beat']
      .forEach(f => s.push(f.replace('{}', l))); });
  if (genre) { const g = genre.toLowerCase();
    ['{} type beat', '{} instrumental', '{} type beat ' + year, 'free {} type beat', '{} beat']
      .forEach(f => s.push(f.replace('{}', g))); }
  ['type beat', 'free type beat', 'type beat ' + year, 'free beat', 'instrumental',
   'free instrumental', 'beats', 'freestyle beat', 'rap beat', 'trap beat'].forEach(x => s.push(x));
  if (bpm) s.push(bpm + ' bpm'); if (key) s.push(key + ' type beat');
  return s;
}
function joinTags(arr, cap) {  // dedupe (case-insensitive), keep order, stay under YouTube's ~500-char cap
  const out = [], seen = new Set(); let len = 0;
  for (const x of arr) { const v = String(x).trim(); const l = v.toLowerCase();
    if (!v || seen.has(l)) continue;
    const add = (out.length ? 2 : 0) + v.length;
    if (len + add > cap) break;
    out.push(v); seen.add(l); len += add;
  }
  return out.join(', ');
}
$('seoGo').onclick = async () => {
  const artists = $('seoArtist').value.split(',').map(s => s.trim()).filter(Boolean);
  const genre = $('seoGenre').value.trim(), song = $('seoSong').value.trim();
  const bpm = $('seoBpm').value.trim(), key = $('seoKey').value.trim();
  const year = new Date().getFullYear();
  if (!artists.length && !genre) { $('seoMsg').textContent = 'Add at least an artist or a genre.'; return; }
  const a0 = artists[0] || '', parts = [];
  if (song) parts.push('"' + song + '"');
  if (a0) parts.push(a0 + (artists[1] ? ' x ' + artists[1] : '') + ' Type Beat');
  parts.push((genre ? genre + ' ' : '') + 'Type Beat ' + year);
  const t = ('[FREE] ' + parts.join(' | ')).slice(0, 100);

  // seed the live autocomplete with the queries buyers actually type
  const seeds = [];
  artists.forEach(a => seeds.push(a + ' type beat'));
  if (genre) seeds.push(genre + ' type beat');
  if (a0 && song) seeds.push(a0 + ' type beat ' + song);
  seeds.push('free type beat ' + year);
  $('seoGo').disabled = true; $('seoMsg').textContent = 'Pulling live YouTube searches…';
  let live = [];
  try {
    const lists = await Promise.all(seeds.map(q =>
      fetch('/suggest?q=' + encodeURIComponent(q)).then(r => r.ok ? r.json() : []).catch(() => [])));
    const seen = new Set();
    lists.flat().forEach(x => { const v = String(x).trim();
      if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); live.push(v); } });
  } catch (e) {}
  $('seoGo').disabled = false;

  // tags: real searches first (demand order) + a couple evergreen; fall back if the pull was empty
  const pool = live.length
    ? live.concat(['free type beat', 'type beat ' + year, bpm ? bpm + ' bpm' : ''].filter(Boolean))
    : fallbackTags(artists, genre, year, bpm, key);
  const tagStr = joinTags(pool, 480);
  title.value = t; tags.value = tagStr; saveYt();
  $('batchTitle').value = t; $('batchTags').value = tagStr;
  [$('batchTitle'), $('batchTags')].forEach(el => el.dispatchEvent(new Event('input')));

  // show the real demand-ordered searches as chips (informational — already folded into tags)
  const box = $('seoSuggest'); box.innerHTML = '';
  (live.length ? live : pool).slice(0, 24).forEach(s => {
    const p = document.createElement('span'); p.textContent = s;
    p.style.cssText = 'display:inline-block;background:#2a2a2c;border:1px solid #444;border-radius:14px;' +
      'padding:3px 9px;margin:3px 3px 0 0;font-size:.75rem;color:#ddd';
    box.appendChild(p);
  });
  $('seoMsg').textContent = live.length
    ? '✓ ' + live.length + ' real YouTube searches pulled (chips = demand order) → used as tags in Single & Batch.'
    : '⚠ Could not reach YouTube suggest (offline?). Used the standard tag set instead.';
  updateTextScore();  // reflect the freshly-generated title/tags in the score
};

// ---- SEO scorecard (TubeBuddy-style): live grade of title/description/tags + thumbnail ----
const scoreColor = s => s >= 70 ? '#1a7f4b' : s >= 50 ? '#c99700' : '#e0245e';
const scoreLabel = s => s >= 85 ? 'Excellent' : s >= 70 ? 'Good' : s >= 50 ? 'Needs work' : 'Poor';
function renderScore(box, score, checks) {
  const col = scoreColor(score), dot = st => st === 'good' ? '🟢' : st === 'warn' ? '🟡' : '🔴';
  box.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
      '<b style="font-size:1.3rem;color:' + col + '">' + score + '</b>' +
      '<span style="color:' + col + ';font-weight:600">' + scoreLabel(score) + '</span>' +
      '<div style="flex:1;height:8px;background:#333;border-radius:4px;overflow:hidden">' +
      '<div style="height:100%;width:' + score + '%;background:' + col + '"></div></div></div>' +
    checks.map(c => '<div style="font-size:.8rem;margin:3px 0;color:#ccc">' + dot(c.state) + ' ' + c.label +
      (c.detail ? ' <span style="color:#888">(' + c.detail + ')</span>' : '') +
      (c.state !== 'good' && c.tip ? ' <span style="color:#888">— ' + c.tip + '</span>' : '') + '</div>').join('');
}
// weighted, transparent checks — the same factors YouTube search actually rewards
const SEO_W = {ttbeat: 15, tlen: 10, intent: 5, dlen: 12, dtop: 10, drep: 6, dlink: 6, dhash: 3, dcta: 3,
               tcount: 10, tbudget: 8, ttag: 7};
function scoreText() {
  const T = title.value.trim(), D = description.value, G = tags.value;
  const arts = $('seoArtist').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const gen = $('seoGenre').value.trim().toLowerCase();
  const kws = ['type beat', ...arts, ...(gen ? [gen] : [])];
  const has = s => kws.some(k => s.toLowerCase().includes(k));
  const kwCount = kws.reduce((n, k) => n + (D.toLowerCase().split(k).length - 1), 0);
  const tagArr = G.split(',').map(s => s.trim()).filter(Boolean);
  const tl = T.length, dl = D.length;
  const c = [
    ['ttbeat', 'Title has "type beat"', /type beat/i.test(T) ? 'good' : 'bad', '', 'Buyers search "&lt;artist&gt; type beat".'],
    ['tlen', 'Title length', tl >= 30 && tl <= 70 ? 'good' : tl > 70 && tl <= 100 ? 'warn' : 'bad', tl + ' chars',
      tl < 30 ? 'Too short — use the space.' : tl > 100 ? 'Over 100 gets cut off.' : tl > 70 ? '~70 is what shows in search.' : ''],
    ['intent', 'Buyer intent (free / year)', /\\bfree\\b|\\b20\d\d\\b/i.test(T) ? 'good' : 'warn', '', 'Add [FREE] and the year.'],
    ['dlen', 'Description length', dl >= 600 ? 'good' : dl >= 200 ? 'warn' : 'bad', dl + ' chars',
      dl < 200 ? 'Write 3–5 lines minimum.' : dl < 600 ? 'Longer descriptions rank better.' : ''],
    ['dtop', 'Keyword in first line', has(D.slice(0, 150)) ? 'good' : 'bad', '', 'Put "type beat"/artist up top.'],
    ['drep', 'Keyword repeated', kwCount >= 2 ? 'good' : 'warn', kwCount + '×', 'Mention key terms 2–3×.'],
    ['dlink', 'Has a link', /https?:\/\//i.test(D) ? 'good' : 'warn', '', 'Add your buy/lease + socials links.'],
    ['dhash', 'Has hashtags', /#\w/.test(D) ? 'good' : 'warn', '', '3 hashtags show above the title.'],
    ['dcta', 'Call to action', /(subscribe|buy|lease|purchase|\\bdm\\b|link in)/i.test(D) ? 'good' : 'warn', '', 'Tell them to buy/subscribe.'],
    ['tcount', 'Tag count', tagArr.length >= 10 ? 'good' : tagArr.length >= 5 ? 'warn' : 'bad', tagArr.length + '',
      tagArr.length < 10 ? 'Aim for 15+ (use the generator).' : ''],
    ['tbudget', 'Tag budget used', G.length >= 300 ? 'good' : 'warn', G.length + '/500', 'Use more of the ~500-char budget.'],
    ['ttag', '"type beat" in tags', /type beat/i.test(G) ? 'good' : 'bad', '', 'Include your core keyword as a tag.'],
  ];
  const pts = {good: 1, warn: 0.5, bad: 0};
  let got = 0, max = 0;
  const checks = c.map(([k, label, state, detail, tip]) => { const w = SEO_W[k]; got += w * pts[state]; max += w;
    return {label, state, detail, tip}; });
  return {score: Math.round(100 * got / max), checks};
}
const updateTextScore = () => { const {score, checks} = scoreText(); renderScore($('seoScoreBox'), score, checks); };
[title, description, tags].forEach(el => el.addEventListener('input', updateTextScore));
updateTextScore();
$('thumbnail').addEventListener('change', async () => {
  const f = $('thumbnail').files[0], box = $('thumbScoreBox');
  if (!f) { box.innerHTML = ''; return; }
  box.innerHTML = '<span class="hint">Rating thumbnail…</span>';
  try {
    const fd = new FormData(); fd.append('thumbnail', f);
    const r = await fetch('/thumb_score', {method: 'POST', body: fd});
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json(); renderScore(box, j.score, j.checks);
  } catch (e) { box.innerHTML = '<span class="hint">Could not rate thumbnail: ' + e.message + '</span>'; }
});

// ---- Auto-Short toggle (single pane) ----
const alsoShort = $('alsoShort');
alsoShort.checked = localStorage.getItem('beatvideo_short') === '1';
const syncShort = () => { $('shortLenRow').style.display = alsoShort.checked ? 'block' : 'none';
  localStorage.setItem('beatvideo_short', alsoShort.checked ? '1' : '0'); };
alsoShort.onchange = syncShort; syncShort();

const MAX_CLIP = 5, clips = [];
let inPoint = null;
const fmt = t => t.toFixed(1) + 's';

// drag & drop onto each upload field — its own label is the drop zone, so cards with
// several file inputs (the batch card: beats + covers) each get an independent target.
// Works even when Safari won't open the file dialog.
document.querySelectorAll('input[type=file]').forEach(input => {
  const zone = input.closest('label') || input.closest('.card');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.outline = '2px dashed #e0245e'; });
  zone.addEventListener('dragleave', () => zone.style.outline = '');
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.style.outline = '';
    input.files = e.dataTransfer.files;
    input.dispatchEvent(new Event('change'));
  });
});

const autoPick = $('autoPick'), manualrow = $('manualrow');
function syncAuto() {
  const manual = autoPick.checked ? 'none' : '';
  manualrow.style.display = marks.style.display = cliplist.style.display = manual;
  $('autorow').style.display = autoPick.checked ? 'block' : 'none';
}
autoPick.onchange = syncAuto;
source.onchange = () => {
  clips.length = 0; inPoint = null; renderClips();
  if (!source.files[0]) { player.style.display = pickrow.style.display = 'none'; return; }
  player.src = URL.createObjectURL(source.files[0]);
  player.style.display = 'block'; pickrow.style.display = 'block';
  marks.textContent = 'Play the video and mark clip start/end.';
  syncAuto();
};
markIn.onclick = () => {
  inPoint = player.currentTime;
  marks.textContent = 'Start at ' + fmt(inPoint) + ' — now mark the end (max ' + MAX_CLIP + 's later).';
};
markOut.onclick = () => {
  if (inPoint === null) { marks.textContent = 'Mark a start first.'; return; }
  let end = player.currentTime;
  if (end <= inPoint) { marks.textContent = 'End must be after start.'; return; }
  if (end - inPoint > MAX_CLIP) { end = inPoint + MAX_CLIP; marks.textContent = 'Trimmed to ' + MAX_CLIP + 's (copyright-safe cap).'; }
  else marks.textContent = 'Clip added.';
  clips.push({start: +inPoint.toFixed(2), end: +end.toFixed(2)});
  inPoint = null; renderClips();
};
function renderClips() {
  cliplist.innerHTML = '';
  clips.forEach((c, i) => {
    const li = document.createElement('li');
    li.textContent = fmt(c.start) + ' → ' + fmt(c.end) + ' ';
    const x = Object.assign(document.createElement('button'), {textContent: '✕', className: 'mini'});
    x.onclick = () => { clips.splice(i, 1); renderClips(); };
    li.appendChild(x); cliplist.appendChild(li);
  });
}
go.onclick = async () => {
  if (!beat.files[0]) { msg.textContent = 'Pick a beat.'; return; }
  const auto = source.files[0] && autoPick.checked;
  if (!auto && !clips.length && !media.files.length) { msg.textContent = 'Add at least one clip or picture.'; return; }
  const fd = new FormData();
  fd.append('beat', beat.files[0]);
  fd.append('filter', filterSel.value);
  fd.append('fmt', $('fmt').value);
  fd.append('beat_sync', $('beatSync').checked ? 'on' : 'off');
  fd.append('overlay_text', $('overlayText').value);
  fd.append('overlay_font', $('overlayFont').value);
  fd.append('visualizer', $('visualizer').value);
  if (auto) {
    fd.append('source', source.files[0]); fd.append('clips', 'auto');
    fd.append('head_skip', $('headSkip').value); fd.append('tail_skip', $('tailSkip').value);
  }
  else if (clips.length) { fd.append('source', source.files[0]); fd.append('clips', JSON.stringify(clips)); }
  for (const f of media.files) fd.append('media', f);
  const yt = youtubeSel.value;
  fd.append('youtube', yt);
  fd.append('title', title.value);
  fd.append('description', description.value);
  fd.append('tags', tags.value);
  const scheduled = yt !== 'off' && scheduleAt.value;
  if (scheduled) fd.append('publish_at', new Date(scheduleAt.value).toISOString());  // local -> UTC
  if (yt !== 'off' && alsoShort.checked) { fd.append('also_short', 'on'); fd.append('short_len', $('shortLen').value); }
  if (yt !== 'off' && $('thumbnail').files[0]) {
    fd.append('thumbnail', $('thumbnail').files[0]);
    fd.append('thumb_filter', $('thumbFilter').value);
  }
  go.disabled = true;
  msg.textContent = yt === 'off' ? 'Rendering… this can take a minute for long beats.'
                  : scheduled ? 'Rendering, then scheduling on YouTube…'
                              : 'Rendering, then uploading to YouTube…';
  try {
    const r = await fetch('/make', {method: 'POST', body: fd});
    if (!r.ok) throw new Error(await r.text());
    if (yt !== 'off') {
      const j = await r.json();
      const link = '<a href="' + j.youtube_url + '" target="_blank">' + j.youtube_url + '</a>';
      msg.innerHTML = (scheduled
        ? 'Scheduled — goes Public ' + new Date(scheduleAt.value).toLocaleString() + ': ' + link
        : 'Uploaded (' + j.privacy + '): ' + link)
        + (j.thumbnail_error ? '<br><span style="color:#e0a">⚠ ' + j.thumbnail_error + '</span>' : '')
        + (j.short_url ? '<br>🎬 Short: <a href="' + j.short_url + '" target="_blank">' + j.short_url + '</a>' : '')
        + (j.short_error ? '<br><span style="color:#e0a">⚠ ' + j.short_error + '</span>' : '');
    } else {
      const beatInfo = r.headers.get('X-Beat');
      const url = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement('a'), {href: url, download: 'beat_video.mp4'});
      a.click();
      msg.textContent = 'Done — downloaded beat_video.mp4' + (beatInfo ? ' (' + beatInfo + ')' : '');
    }
  } catch (e) { msg.textContent = 'Failed: ' + e.message; }
  go.disabled = false;
};

// ---- Batch schedule ----
const batchBeats = $('batchBeats'), batchStart = $('batchStart'), batchInterval = $('batchInterval'),
      batchRows = $('batchRows'), batchGo = $('batchGo'), batchMsg = $('batchMsg');
const toLocalInput = d => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
batchStart.min = toLocalInput(new Date());
// default: tomorrow at 17:00 local (a solid, consistent upload slot)
{ const d = new Date(Date.now() + 86400000); d.setHours(17, 0, 0, 0);
  if (!batchStart.value) batchStart.value = toLocalInput(d); }
// remember the batch description/tags template across sessions
for (const [id, key] of [['batchTitle', 'beatvideo_btitle'], ['batchDescription', 'beatvideo_bdesc'], ['batchTags', 'beatvideo_btags']]) {
  const el = $(id);
  if (localStorage.getItem(key)) el.value = localStorage.getItem(key);
  el.addEventListener('input', () => localStorage.setItem(key, el.value));
}

const fieldCss = 'width:100%;padding:8px;border-radius:6px;background:#2a2a2c;color:#eee;border:1px solid #444;box-sizing:border-box';
const descTemplate = title => ($('batchDescription').value || '').split('{title}').join(title);
const titleFor = stem => { const t = ($('batchTitle').value || '').trim();
  return t ? t.split('{name}').join(stem) : stem; };
const cap = t => { const s = document.createElement('div'); s.textContent = t;
  s.style.cssText = 'color:#888;font-size:.72rem;margin:8px 0 2px;font-weight:600'; return s; };
function buildBatchRows() {
  batchRows.innerHTML = '';
  const files = [...batchBeats.files];
  if (!files.length) {
    batchRows.innerHTML = '<div class="hint" style="text-align:center;padding:14px;border:1px dashed #333;border-radius:10px">' +
      'Add beats above — each one gets its own editable <b>title</b>, <b>description</b> &amp; <b>publish date</b> here.</div>';
    return;
  }
  files.forEach(f => {
    const stem = f.name.replace(/\.[^.]+$/, '');
    const block = document.createElement('div');
    block.style.cssText = 'border:1px solid #333;border-radius:10px;padding:10px 12px;margin-bottom:10px';
    const head = document.createElement('div');
    head.textContent = '🎵 ' + f.name;
    head.style.cssText = 'font-weight:600;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const audio = document.createElement('audio');
    audio.controls = true; audio.src = URL.createObjectURL(f);
    audio.style.cssText = 'width:100%;margin-top:6px';
    const title = document.createElement('input');
    title.className = 'btitle'; title.dataset.stem = stem; title.value = titleFor(stem); title.style.cssText = fieldCss;
    const desc = document.createElement('textarea');
    desc.className = 'bdesc'; desc.rows = 3; desc.style.cssText = 'font:inherit;resize:vertical;' + fieldCss;
    desc.value = descTemplate(title.value);
    const date = document.createElement('input');
    date.type = 'datetime-local'; date.className = 'bdate'; date.style.cssText = fieldCss;
    // per-beat "copy from a past video" — search box; fills just this row's title + description
    const reuse = document.createElement('input');
    reuse.className = 'reuseInp'; reuse.setAttribute('list', 'pastList');
    reuse.placeholder = '🔎 Copy title & description from a past video…'; reuse.style.cssText = fieldCss;
    reuse.addEventListener('focus', loadPast);
    reuse.addEventListener('change', () => {
      const v = pickedVideo(reuse); if (!v) return;
      title.value = v.title; title.dataset.edited = '1';        // pin so batch defaults won't overwrite
      desc.value = v.description; desc.dataset.edited = '1';
      reuse.value = '';
    });
    // once a field is hand-edited it stops following the defaults above
    title.addEventListener('input', () => { title.dataset.edited = '1';
      if (!desc.dataset.edited) desc.value = descTemplate(title.value); });
    desc.addEventListener('input', () => desc.dataset.edited = '1');
    block.append(head, audio, cap('Title'), title, cap('Description'), desc,
                 cap('Or copy from a past video'), reuse, cap('Publishes'), date);
    batchRows.appendChild(block);
  });
  fillBatchDates();
}
// push the default title/description into every row that hasn't been hand-edited.
// reset=true (the Apply button) clears edits and re-applies to ALL rows.
function syncBatchDefaults(reset) {
  const titles = [...batchRows.querySelectorAll('.btitle')];
  const descs = [...batchRows.querySelectorAll('.bdesc')];
  titles.forEach((t, i) => {
    if (reset) { delete t.dataset.edited; delete descs[i].dataset.edited; }
    if (!t.dataset.edited) t.value = titleFor(t.dataset.stem);
    if (!descs[i].dataset.edited) descs[i].value = descTemplate(t.value);
  });
}
$('batchTitle').addEventListener('input', () => syncBatchDefaults(false));
$('batchDescription').addEventListener('input', () => syncBatchDefaults(false));
$('batchApplyDesc').onclick = () => syncBatchDefaults(true);
function fillBatchDates() {
  if (!batchStart.value) return;
  const start = new Date(batchStart.value), gap = Math.max(0, +batchInterval.value || 0);
  const dates = [...batchRows.querySelectorAll('.bdate')];
  dates.forEach((inp, i) => { inp.value = toLocalInput(new Date(start.getTime() + i * gap * 86400000)); });
  $('batchSummary').textContent = dates.length
    ? dates.length + ' video(s) · every ' + gap + ' day(s) · ' +
      new Date(dates[0].value).toLocaleDateString() + ' → ' + new Date(dates[dates.length - 1].value).toLocaleDateString()
    : '';
}
batchBeats.onchange = buildBatchRows;
batchStart.onchange = fillBatchDates;
batchInterval.oninput = fillBatchDates;
$('batchCadence').onchange = () => { batchInterval.value = $('batchCadence').value; fillBatchDates(); };
buildBatchRows();  // show the empty-state hint up front

batchGo.onclick = async () => {
  if (!batchBeats.files.length) { batchMsg.textContent = 'Add at least one beat.'; return; }
  if (!$('batchCovers').files.length) { batchMsg.textContent = 'Add at least one cover image.'; return; }
  const fd = new FormData();
  for (const f of batchBeats.files) fd.append('beats', f);
  for (const f of $('batchCovers').files) fd.append('covers', f);
  fd.append('titles', JSON.stringify([...batchRows.querySelectorAll('.btitle')].map(i => i.value)));
  fd.append('descriptions', JSON.stringify([...batchRows.querySelectorAll('.bdesc')].map(i => i.value)));
  fd.append('schedule', JSON.stringify([...batchRows.querySelectorAll('.bdate')]
    .map(i => i.value ? new Date(i.value).toISOString() : '')));
  fd.append('fmt', $('fmt').value);
  fd.append('filter', filterSel.value);
  fd.append('overlay_text', $('overlayText').value);
  fd.append('overlay_font', $('overlayFont').value);
  fd.append('visualizer', $('visualizer').value);
  fd.append('description', $('batchDescription').value);
  fd.append('tags', $('batchTags').value);
  batchGo.disabled = true;
  batchMsg.textContent = 'Rendering & uploading ' + batchBeats.files.length + ' videos… this takes a while, keep this tab open.';
  try {
    const r = await fetch('/batch', {method: 'POST', body: fd});
    if (!r.ok) throw new Error(await r.text());
    const {results} = await r.json();
    batchMsg.innerHTML = results.map(x => x.error
      ? '⚠ <b>' + x.title + '</b>: ' + x.error
      : '✅ <b>' + x.title + '</b> → <a href="' + x.youtube_url + '" target="_blank">link</a>' +
        (x.publish_at ? ' · ' + new Date(x.publish_at).toLocaleString() : ' · now (Private)')
    ).join('<br>');
  } catch (e) { batchMsg.textContent = 'Failed: ' + e.message; }
  batchGo.disabled = false;
};
</script>"""
