#!/usr/bin/env python3
"""Local YouTube downloader UI over the yt-dlp binary. Zero dependencies."""
# ponytail: stdlib http.server, no FastAPI/venv needed — it's a single-user local tool
import json, re, subprocess, threading, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

YTDLP = "/opt/homebrew/bin/yt-dlp"
OUTDIR = Path.home() / "Downloads"
PORT = 8005
jobs = {}  # id -> {"pct": float, "status": "running|done|error", "msg": str}

HTML = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YT Downloader</title><style>
body{font-family:-apple-system,sans-serif;background:#0f1115;color:#e8e8e8;max-width:640px;margin:40px auto;padding:0 16px}
h1{font-size:22px}input,select,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #333;background:#1a1d24;color:#eee}
input{width:100%;box-sizing:border-box}button{background:#e33;border:0;cursor:pointer;font-weight:600}
button:disabled{opacity:.5}.row{display:flex;gap:8px;margin-top:12px}
#card{display:none;margin-top:20px;background:#1a1d24;border-radius:12px;padding:16px}
#thumb{width:100%;border-radius:8px}#bar{height:8px;background:#333;border-radius:4px;margin-top:14px;overflow:hidden}
#fill{height:100%;width:0;background:#3c6;transition:width .3s}#status{margin-top:8px;font-size:14px;color:#aaa}
</style></head><body>
<h1>🎬 YouTube Downloader</h1>
<input id="url" placeholder="Paste YouTube URL…">
<div class="row"><button id="fetch" onclick="fetchInfo()">Fetch</button></div>
<div id="card">
  <img id="thumb"><h3 id="title"></h3>
  <div class="row">
    <select id="fmt"></select>
    <button id="dl" onclick="download()">Download</button>
  </div>
  <div id="bar"><div id="fill"></div></div><div id="status"></div>
</div>
<script>
async function fetchInfo(){
  const b=document.getElementById('fetch');b.disabled=true;b.textContent='…';
  try{
    const r=await fetch('/info?url='+encodeURIComponent(document.getElementById('url').value));
    const d=await r.json();
    if(d.error){alert(d.error);return}
    document.getElementById('card').style.display='block';
    document.getElementById('thumb').src=d.thumbnail;
    document.getElementById('title').textContent=d.title;
    const s=document.getElementById('fmt');s.innerHTML='';
    d.heights.forEach(h=>s.add(new Option(h+'p video (mp4)',h)));
    s.add(new Option('Audio only — MP3 320k','mp3'));
    s.add(new Option('Audio only — WAV','wav'));
  }finally{b.disabled=false;b.textContent='Fetch'}
}
async function download(){
  const b=document.getElementById('dl');b.disabled=true;
  const q=new URLSearchParams({url:document.getElementById('url').value,fmt:document.getElementById('fmt').value});
  const {id}=await(await fetch('/download?'+q)).json();
  const t=setInterval(async()=>{
    const j=await(await fetch('/progress?id='+id)).json();
    document.getElementById('fill').style.width=j.pct+'%';
    document.getElementById('status').textContent=j.msg;
    if(j.status!=='running'){clearInterval(t);b.disabled=false;
      document.getElementById('status').textContent=j.status==='done'?'✅ Saved to ~/Downloads':'❌ '+j.msg}
  },700);
}
</script></body></html>"""


def run_download(job_id, url, fmt):
    if fmt in ("mp3", "wav"):
        args = ["-x", "--audio-format", fmt, "--audio-quality", "0"]
        out = "%(title)s.%(ext)s"
    else:
        # Prefer H.264+AAC (plays everywhere), but always fall back to *something* so a
        # download never silently produces no file. Last resorts may be VP9/AV1 (VLC-only).
        f = fmt
        chain = (f"bv*[height<={f}][vcodec^=avc1]+ba[ext=m4a]/"
                 f"bv*[height<={f}][vcodec^=avc1]+ba/"
                 f"b[height<={f}][vcodec^=avc1]/"
                 f"bv*[height<={f}]+ba/b[height<={f}]/b")
        # resolution in the name so 720p and 1080p of the same video don't collide
        args = ["-f", chain, "--merge-output-format", "mp4"]
        out = "%(title)s [%(height)sp].%(ext)s"
    # --force-overwrites: re-download always produces the file instead of silently
    # skipping with "already downloaded" and reporting a success that wrote nothing
    cmd = [YTDLP, *args, "--no-playlist", "--force-overwrites", "--newline",
           "-o", str(OUTDIR / out), url]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    tail = []
    for line in p.stdout:
        line = line.rstrip()
        tail.append(line)
        m = re.search(r"(\d+\.?\d*)%", line)
        if m:
            jobs[job_id].update(pct=float(m.group(1)), msg=line[:120])
    p.wait()
    if p.returncode == 0:
        jobs[job_id].update(status="done", pct=100, msg="")
    else:
        err = next((l for l in reversed(tail) if "ERROR" in l), tail[-1] if tail else "download failed")
        print(f"[ytdl] FAILED ({fmt}) {url}\n  " + "\n  ".join(tail[-6:]), flush=True)
        jobs[job_id].update(status="error", msg=err[:200])


class Handler(BaseHTTPRequestHandler):
    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(HTML.encode())
        elif u.path == "/info":
            try:
                out = subprocess.run([YTDLP, "-J", "--no-playlist", q["url"][0]],
                                     capture_output=True, text=True, timeout=60, check=True)
                d = json.loads(out.stdout)
                heights = sorted({f.get("height") for f in d.get("formats", [])
                                  if f.get("height") and f.get("vcodec") != "none"}, reverse=True)
                self.send_json({"title": d["title"], "thumbnail": d.get("thumbnail", ""),
                                "heights": heights[:6]})
            except Exception as e:
                self.send_json({"error": f"Could not fetch video info: {e}"}, 400)
        elif u.path == "/download":
            fmt = q["fmt"][0]
            if not re.fullmatch(r"mp3|wav|\d{3,4}", fmt):
                return self.send_json({"error": "bad format"}, 400)
            job_id = uuid.uuid4().hex[:8]
            jobs[job_id] = {"pct": 0, "status": "running", "msg": "starting…"}
            threading.Thread(target=run_download, args=(job_id, q["url"][0], fmt),
                             daemon=True).start()
            self.send_json({"id": job_id})
        elif u.path == "/progress":
            self.send_json(jobs.get(q["id"][0], {"status": "error", "msg": "unknown job", "pct": 0}))
        else:
            self.send_json({"error": "not found"}, 404)

    def log_message(self, *a):  # quiet
        pass


if __name__ == "__main__":
    print(f"YT Downloader → http://localhost:{PORT}  (saves to {OUTDIR})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
