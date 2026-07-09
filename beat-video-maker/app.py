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

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from starlette.background import BackgroundTask

app = FastAPI(title="BeatVideo")

W, H, FPS = 1920, 1080, 30
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


VF = (f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
      f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,fps={FPS},format=yuv420p")


def scene_starts(src: Path) -> list[float]:
    """Timestamps where ffmpeg detects a scene change (the video's own cuts)."""
    p = subprocess.run(
        ["ffmpeg", "-i", str(src), "-an", "-vf", "select='gt(scene,0.3)',showinfo",
         "-f", "null", "-"], capture_output=True, text=True)
    return [float(t) for t in re.findall(r"pts_time:([0-9.]+)", p.stderr)]


def auto_clips(src: Path, beat_dur: float) -> list[tuple[float, float]]:
    """Pick short clips spread across the video, preferring its own scene cuts."""
    src_dur = duration(src)
    length = min(4.0, src_dur)  # ponytail: fixed 4s clips, stays under the 5s cap
    n = max(3, min(12, round(beat_dur / length)))
    starts = [t for t in scene_starts(src) if t <= src_dur - length]
    if len(starts) >= n:  # sample n cuts evenly across the whole video
        starts = sorted({starts[round(i * (len(starts) - 1) / (n - 1))] for i in range(n)})
    else:  # few/no scene changes — fall back to evenly spaced starts
        step = max(src_dur - length, 0) / max(n - 1, 1)
        starts = [i * step for i in range(n)]
    return [(round(s, 2), round(s + length, 2)) for s in starts]


def normalize(src: Path, dst: Path, vf_extra: str = "", start: Optional[float] = None,
              length: Optional[float] = None) -> None:
    """Re-encode an image, video, or video slice into a uniform silent 1080p segment."""
    pre = []
    if src.suffix.lower() in IMAGE_EXTS:
        pre = ["-loop", "1", "-t", str(IMAGE_SECONDS)]
    if start is not None:
        pre += ["-ss", str(start), "-t", str(length)]
    vf = VF + ("," + vf_extra if vf_extra else "")
    # ultrafast/crf23: YouTube re-encodes uploads anyway, so spend nothing on finesse
    run(["ffmpeg", "-y", *pre, "-i", str(src), "-an", "-vf", vf,
         "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", str(dst)])


def build(beat: Path, media: list[Path], out: Path, vf_extra: str = "",
          source: Optional[Path] = None, clips: Optional[list[tuple[float, float]]] = None) -> None:
    beat_dur = duration(beat)
    work = beat.parent
    segs = []
    if clips:
        for i, (start, end) in enumerate(clips):
            seg = work / f"seg{i}.mp4"
            normalize(source, seg, vf_extra, start=start, length=end - start)
            segs.append((seg, duration(seg)))
    for i, m in enumerate(media):
        seg = work / f"m{i}.mp4"
        normalize(m, seg, vf_extra)
        segs.append((seg, duration(seg)))

    # cycle through the segments until we cover the beat, then hard-cut at beat end
    concat = work / "list.txt"
    lines, total, i = [], 0.0, 0
    while total < beat_dur:
        seg, d = segs[i % len(segs)]
        lines.append(f"file '{seg}'")
        total += d
        i += 1
    concat.write_text("\n".join(lines) + "\n")

    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
         "-i", str(beat), "-map", "0:v", "-map", "1:a",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         "-t", str(beat_dur), "-movflags", "+faststart", str(out)])


@app.post("/make")
async def make(beat: UploadFile = File(...), media: list[UploadFile] = File(default=[]),
               source: Optional[UploadFile] = File(default=None), clips: str = Form(default=""),
               filter: str = Form(default="none"), youtube: str = Form(default="off"),
               title: str = Form(default=""), description: str = Form(default=""),
               tags: str = Form(default=""), publish_at: str = Form(default=""),
               thumbnail: Optional[UploadFile] = File(default=None),
               thumb_filter: str = Form(default="none")):
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
            clip_list = auto_clips(source_path, duration(beat_path))
        thumb_path = None
        if thumbnail is not None and youtube != "off":
            thumb_path = work / ("thumb" + Path(thumbnail.filename).suffix.lower())
            thumb_path.write_bytes(await thumbnail.read())
            if thumb_vf:  # run the thumbnail through the same ffmpeg color filter
                filtered = work / ("thumb_f" + thumb_path.suffix)
                run(["ffmpeg", "-y", "-i", str(thumb_path), "-vf", thumb_vf, str(filtered)])
                thumb_path = filtered
        out = work / "beat_video.mp4"
        build(beat_path, media_paths, out, vf_extra, source_path, clip_list)
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
            return {"youtube_url": f"https://youtu.be/{video_id}", "privacy": youtube,
                    "publish_at": publish_at, "thumbnail_error": thumb_note}
    except Exception:
        shutil.rmtree(work, ignore_errors=True)
        raise
    finally:
        if youtube != "off":
            shutil.rmtree(work, ignore_errors=True)
    return FileResponse(out, media_type="video/mp4", filename="beat_video.mp4",
                        background=BackgroundTask(shutil.rmtree, work, ignore_errors=True))


@app.get("/youtube/videos")
def youtube_videos():
    import youtube as yt  # local-only
    try:
        return yt.list_recent()
    except RuntimeError as e:
        raise HTTPException(400, str(e))


@app.get("/", response_class=HTMLResponse)
def index():
    return """<!doctype html>
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
</style>
<h1>🎬 BeatVideo</h1>
<p>Upload your beat, then pick short clips from a music video (max 5s each — keeps you safer
from copyright strikes) and/or add your own pictures. Tip: you can also drag &amp; drop files
onto the boxes below.</p>
<div class="card"><label>Beat (mp3 / wav)<input type="file" id="beat" accept="audio/*"></label></div>
<div class="card">
  <label>Music video (clips are cut from this)<input type="file" id="source" accept="video/*"></label>
  <video id="player" controls playsinline style="width:100%;margin-top:10px;border-radius:8px;display:none"></video>
  <div id="pickrow" style="display:none;margin-top:10px">
    <label style="font-weight:400"><input type="checkbox" id="autoPick" checked>
      ✨ Auto-pick clips for me (uses the video's own scene cuts)</label>
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
<div class="card"><label>Filter</label>
  <select id="filter">
    <option value="none">None</option><option value="bw">Black &amp; white</option>
    <option value="warm">Warm</option><option value="cool">Cool</option>
    <option value="punch">Punchy (contrast + saturation)</option><option value="vhs">VHS / vintage</option>
  </select></div>
<div class="card"><label>Upload to YouTube</label>
  <select id="youtube">
    <option value="off">No — just download the file</option>
    <option value="private">Yes — Private (only you)</option>
    <option value="unlisted">Yes — Unlisted (link only)</option>
    <option value="public">Yes — Public</option>
  </select>
  <div id="ytdetails" style="display:none">
    <select id="reuseFrom"><option value="">↺ Copy details from a past video…</option></select>
    <input type="text" id="title" placeholder="Video title">
    <textarea id="description" rows="3" placeholder="Description"></textarea>
    <input type="text" id="tags" placeholder="Tags, comma separated (afrobeats, type beat, free beat)">
    <label style="font-weight:400;margin-top:10px">Custom thumbnail (optional, JPG/PNG under 2MB)
      <input type="file" id="thumbnail" accept="image/*"></label>
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
  </div>
</div>
<button id="go">Make video</button>
<div id="msg"></div>
<script>
const $ = id => document.getElementById(id);
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
function syncYt() {
  const show = youtubeSel.value !== 'off';
  ytdetails.style.display = show ? 'block' : 'none';
  if (show) loadPast();
}
for (const el of Object.values(YT_FIELDS)) el.addEventListener('input', () => { saveYt(); syncYt(); });

// pull title/description/tags from a video already on the channel and reuse them
let pastVideos = [], loadedPast = false;
async function loadPast() {
  if (loadedPast) return;
  loadedPast = true;
  try {
    const r = await fetch('/youtube/videos');
    if (!r.ok) throw new Error(await r.text());
    pastVideos = await r.json();
    pastVideos.forEach((v, i) =>
      reuseFrom.appendChild(new Option((v.title || '(untitled)').slice(0, 70), String(i))));
    if (!pastVideos.length) reuseFrom.appendChild(new Option('(no past videos found)', ''));
  } catch (e) {
    loadedPast = false;  // let it retry next open
    reuseFrom.appendChild(new Option('(could not load videos)', ''));
  }
}
reuseFrom.onchange = () => {
  const v = pastVideos[reuseFrom.value];
  if (!v) return;
  title.value = v.title;
  description.value = v.description;
  tags.value = (v.tags || []).join(', ');
  saveYt();
};
syncYt();
const MAX_CLIP = 5, clips = [];
let inPoint = null;
const fmt = t => t.toFixed(1) + 's';

// drag & drop onto any upload card — works even when Safari won't open the file dialog
document.querySelectorAll('.card').forEach(card => {
  const input = card.querySelector('input[type=file]');
  if (!input) return;
  card.addEventListener('dragover', e => { e.preventDefault(); card.style.outline = '2px dashed #e0245e'; });
  card.addEventListener('dragleave', () => card.style.outline = '');
  card.addEventListener('drop', e => {
    e.preventDefault(); card.style.outline = '';
    input.files = e.dataTransfer.files;
    input.dispatchEvent(new Event('change'));
  });
});

const autoPick = $('autoPick'), manualrow = $('manualrow');
function syncAuto() {
  const manual = autoPick.checked ? 'none' : '';
  manualrow.style.display = marks.style.display = cliplist.style.display = manual;
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
  if (auto) { fd.append('source', source.files[0]); fd.append('clips', 'auto'); }
  else if (clips.length) { fd.append('source', source.files[0]); fd.append('clips', JSON.stringify(clips)); }
  for (const f of media.files) fd.append('media', f);
  const yt = youtubeSel.value;
  fd.append('youtube', yt);
  fd.append('title', title.value);
  fd.append('description', description.value);
  fd.append('tags', tags.value);
  const scheduled = yt !== 'off' && scheduleAt.value;
  if (scheduled) fd.append('publish_at', new Date(scheduleAt.value).toISOString());  // local -> UTC
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
        + (j.thumbnail_error ? '<br><span style="color:#e0a">⚠ ' + j.thumbnail_error + '</span>' : '');
    } else {
      const url = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement('a'), {href: url, download: 'beat_video.mp4'});
      a.click();
      msg.textContent = 'Done — downloaded beat_video.mp4';
    }
  } catch (e) { msg.textContent = 'Failed: ' + e.message; }
  go.disabled = false;
};
</script>"""
