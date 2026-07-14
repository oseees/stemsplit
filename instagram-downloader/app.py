#!/usr/bin/env python3
"""Local Instagram photo/video downloader UI over the gallery-dl binary. Zero dependencies."""
# ponytail: gallery-dl, not yt-dlp — yt-dlp silently drops Instagram photos ("No video formats
# found") and only grabs videos. gallery-dl is purpose-built for IG photos+videos+carousels.
# Stdlib http.server, no FastAPI/venv. Single-user local tool.
import json, re, subprocess, threading, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

TOOL = "/opt/homebrew/bin/gallery-dl"
OUTDIR = Path.home() / "Downloads"
COOKIE_FILE = Path(__file__).parent / ".cookies.txt"
PORT = 8007
jobs = {}  # id -> {"pct": float, "status": "running|done|error", "msg": str}

HTML = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Instagram Downloader</title><style>
body{font-family:-apple-system,sans-serif;background:#0f1115;color:#e8e8e8;max-width:640px;margin:40px auto;padding:0 16px}
h1{font-size:22px}input,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #333;background:#1a1d24;color:#eee}
input{width:100%;box-sizing:border-box}
button{background:linear-gradient(45deg,#f09433,#dc2743,#bc1888);border:0;cursor:pointer;font-weight:600}
button:disabled{opacity:.5}.row{display:flex;gap:8px;margin-top:12px;align-items:center}
label{font-size:14px;color:#aaa}#card{display:none;margin-top:20px;background:#1a1d24;border-radius:12px;padding:16px}
#bar{height:8px;background:#333;border-radius:4px;margin-top:14px;overflow:hidden}
#fill{height:100%;width:0;background:#dc2743;transition:width .3s}#status{margin-top:8px;font-size:14px;color:#aaa}
.hint{font-size:13px;color:#888;margin-top:8px}
#grid{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.item{position:relative;width:96px;height:96px;border-radius:8px;overflow:hidden;cursor:pointer;background:#000}
.item img,.item .vid{width:100%;height:100%;object-fit:cover;display:block}
.item .vid{display:flex;align-items:center;justify-content:center;font-size:28px;background:#26272e}
.item input{position:absolute;top:4px;left:4px;width:18px;height:18px;margin:0}
.item.off img,.item.off .vid{opacity:.25}
</style></head><body>
<h1>📸 Instagram Downloader</h1>
<input id="url" placeholder="Paste Instagram post / reel / photo URL…">
<div class="row">
  <button id="fetch" onclick="fetchInfo()">Fetch</button>
  <label><input type="checkbox" id="cookies"> Use Chrome login (for private/blocked posts)</label>
</div>
<p class="hint">Fetch a post, uncheck anything you don't want, then download.</p>
<div id="card">
  <h3 id="title"></h3>
  <div class="row">
    <button id="all" onclick="toggleAll()">Select all / none</button>
  </div>
  <div id="grid"></div>
  <div class="row"><button id="dl" onclick="download()">Download selected</button></div>
  <div id="bar"><div id="fill"></div></div><div id="status"></div>
</div>
<script>
let items=[];
function cookies(){return document.getElementById('cookies').checked?'1':''}
function renderGrid(){
  const g=document.getElementById('grid');g.innerHTML='';
  items.forEach((it,i)=>{
    const cell=document.createElement('div');cell.className='item';
    cell.innerHTML=it.type==='video'
      ? '<div class="vid">🎬</div>'
      : '<img src="'+it.thumb+'" loading="lazy">';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=true;cb.dataset.i=i;
    cb.onclick=e=>{e.stopPropagation();cell.classList.toggle('off',!cb.checked)};
    cell.onclick=()=>{cb.checked=!cb.checked;cell.classList.toggle('off',!cb.checked)};
    cell.appendChild(cb);g.appendChild(cell);
  });
}
function toggleAll(){
  const boxes=[...document.querySelectorAll('#grid input')];
  const anyOff=boxes.some(b=>!b.checked);
  boxes.forEach(b=>{b.checked=anyOff;b.closest('.item').classList.toggle('off',!anyOff)});
}
async function fetchInfo(){
  const b=document.getElementById('fetch');b.disabled=true;b.textContent='…';
  try{
    const q=new URLSearchParams({url:document.getElementById('url').value,cookies:cookies()});
    const r=await fetch('/info?'+q);const d=await r.json();
    if(d.error){alert(d.error);return}
    items=d.items;
    document.getElementById('card').style.display='block';
    document.getElementById('title').textContent=d.title;
    renderGrid();
  }finally{b.disabled=false;b.textContent='Fetch'}
}
async function download(){
  const sel=[...document.querySelectorAll('#grid input')]
    .map((cb,i)=>cb.checked?i+1:null).filter(x=>x);
  if(!sel.length){alert('Pick at least one item');return}
  const b=document.getElementById('dl');b.disabled=true;
  const q=new URLSearchParams({url:document.getElementById('url').value,cookies:cookies(),sel:sel.join(',')});
  const {id}=await(await fetch('/download?'+q)).json();
  const t=setInterval(async()=>{
    const j=await(await fetch('/progress?id='+id)).json();
    document.getElementById('fill').style.width=j.pct+'%';
    document.getElementById('status').textContent=j.msg;
    if(j.status!=='running'){clearInterval(t);b.disabled=false;
      document.getElementById('status').textContent=j.status==='done'?'✅ '+j.msg+' → ~/Downloads':'❌ '+j.msg}
  },700);
}
</script></body></html>"""


def gd(url, use_cookies, *args, from_chrome=False):
    # Cache Chrome's IG session in a cookie file so we only touch the macOS Keychain
    # (and its repeated permission prompt) when the cache is missing or stale — not
    # on every single request. --cookies-export only writes on a real download run,
    # not on a -g dry-run, so /info reuses whatever the last /download produced.
    cmd = [TOOL]
    if use_cookies:
        if not from_chrome and COOKIE_FILE.exists():
            cmd += ["--cookies", str(COOKIE_FILE)]
        else:
            cmd += ["--cookies-from-browser", "chrome", "--cookies-export", str(COOKIE_FILE)]
    return [*cmd, *args, url]


def media_urls(url, use_cookies):
    """gallery-dl -g prints one direct media URL per line (no download); a video prints
    two lines ("ytdl:<page>" + "| <direct-mp4-fallback>"). Returns one entry per item,
    in the same order --range indices (1-based) refer to."""
    out = subprocess.run(gd(url, use_cookies, "-g"), capture_output=True, text=True, timeout=60)
    items = []
    for line in out.stdout.splitlines():
        if not line.strip():
            continue
        if line.startswith("| "):
            items[-1]["thumb"] = line[2:].strip()  # video's real mp4 URL, not previewable as <img>
        else:
            is_video = line.startswith("ytdl:")
            items.append({"type": "video" if is_video else "image",
                          "thumb": "" if is_video else line})
    return items, out


def _download_once(job_id, url, use_cookies, total, range_str, from_chrome):
    args = ["-D", str(OUTDIR)]  # -D: flatten straight into ~/Downloads, no per-user subfolders
    if range_str:
        args = ["--range", range_str] + args  # only fetch the items the user picked
    p = subprocess.Popen(gd(url, use_cookies, *args, from_chrome=from_chrome),
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    saved, tail = 0, []
    for line in p.stdout:
        line = line.rstrip()
        tail.append(line)
        if str(OUTDIR) in line:  # gallery-dl prints each saved file's path
            saved += 1
            jobs[job_id].update(pct=min(99, saved / total * 100), msg=f"Saved {saved}/{total}…")
    p.wait()
    return p.returncode, saved, tail


def run_download(job_id, url, use_cookies, range_str):
    total = len(range_str.split(",")) if range_str else 1
    if not range_str:
        # No selection sent (shouldn't happen from the UI) — fall back to everything.
        try:
            total = len(media_urls(url, use_cookies)[0]) or 1
        except Exception:
            total = 1
    code, saved, tail = _download_once(job_id, url, use_cookies, total, range_str, from_chrome=False)
    # Cached cookie file went stale (session expired) → re-pull fresh cookies from
    # Chrome once and retry, instead of surfacing a login error the user can't act on.
    if saved == 0 and use_cookies and COOKIE_FILE.exists() and \
       any("login" in l.lower() for l in tail):
        code, saved, tail = _download_once(job_id, url, use_cookies, total, range_str, from_chrome=True)
    if code == 0 and saved:
        jobs[job_id].update(status="done", pct=100, msg=f"Saved {saved} file(s)")
    else:
        err = next((l for l in reversed(tail) if "error" in l.lower()),
                   tail[-1] if tail else "nothing downloaded")
        print(f"[ig] FAILED {url}\n  " + "\n  ".join(tail[-6:]), flush=True)
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
                items, out = media_urls(q["url"][0], q.get("cookies", [""])[0])
                if not items:
                    err = (out.stderr or "could not read post").strip().splitlines()
                    hint = err[-1] if err else "could not read post"
                    if "login" in hint.lower() or "403" in hint or "401" in hint:
                        hint = "Tick 'Use Chrome login' (log into Instagram in Chrome first), then retry. — " + hint
                    return self.send_json({"error": hint[:300]}, 400)
                self.send_json({"title": f"Instagram post — {len(items)} item(s)", "items": items})
            except Exception as e:
                self.send_json({"error": f"Could not fetch post: {e}"}, 400)
        elif u.path == "/download":
            sel = q.get("sel", [""])[0]
            if sel and not re.fullmatch(r"\d+(,\d+)*", sel):
                return self.send_json({"error": "bad selection"}, 400)
            job_id = uuid.uuid4().hex[:8]
            jobs[job_id] = {"pct": 0, "status": "running", "msg": "starting…"}
            threading.Thread(target=run_download,
                             args=(job_id, q["url"][0], q.get("cookies", [""])[0], sel),
                             daemon=True).start()
            self.send_json({"id": job_id})
        elif u.path == "/progress":
            self.send_json(jobs.get(q["id"][0], {"status": "error", "msg": "unknown job", "pct": 0}))
        else:
            self.send_json({"error": "not found"}, 404)

    def log_message(self, *a):  # quiet
        pass


if __name__ == "__main__":
    print(f"Instagram Downloader → http://localhost:{PORT}  (saves to {OUTDIR})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
