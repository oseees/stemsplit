"""Runnable check for the off-box backup: multipart encoding over a real HTTP
round-trip, the size guard, dormancy when unconfigured, and the once-a-day
de-dupe. Run: python test_backup.py"""
import os, tempfile, threading, json
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ["SALESPAL_DB"] = tempfile.mkstemp(suffix=".db")[1]

import db; db.init_db()
import backup

# --- dormant until configured -------------------------------------------------
os.environ.pop("SALESPAL_BACKUP_TG_TOKEN", None)
os.environ.pop("SALESPAL_BACKUP_TG_CHAT", None)
assert backup.configured() is False
ok, detail = backup.send(b"x", "a.db")
assert ok is False and "not configured" in detail, detail

# --- size guard ---------------------------------------------------------------
os.environ["SALESPAL_BACKUP_TG_TOKEN"] = "tok"
os.environ["SALESPAL_BACKUP_TG_CHAT"] = "123"
assert backup.configured() is True
ok, detail = backup.send(b"0" * (backup.TG_MAX + 1), "big.db")
assert ok is False and "50MB limit" in detail, detail

# --- real multipart round-trip against a fake Telegram ------------------------
received = {}

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        received["path"] = self.path
        received["ctype"] = self.headers["Content-Type"]
        received["body"] = body
        self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
    def log_message(self, *a): pass

srv = HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]

# point the module at the fake server instead of api.telegram.org
import urllib.request
_orig = urllib.request.Request
def fake_req(url, **kw):
    return _orig(url.replace("https://api.telegram.org", f"http://127.0.0.1:{port}"), **kw)
urllib.request.Request = fake_req

payload = b"SQLITE-FAKE-BYTES\x00\xff binary safe"
ok, detail = backup.send(payload, "salespal-2026-07-19.db", caption="nightly")
urllib.request.Request = _orig
srv.shutdown()

assert ok is True, detail
assert "/bottok/sendDocument" in received["path"], received["path"]
assert received["ctype"].startswith("multipart/form-data; boundary="), received["ctype"]
b = received["body"]
assert b'name="chat_id"' in b and b"123" in b
assert b'name="caption"' in b and b"nightly" in b
assert b'filename="salespal-2026-07-19.db"' in b
assert payload in b, "binary payload must survive multipart encoding intact"

# --- once-a-day de-dupe (the scheduler's guard) -------------------------------
import main
calls = []
main.backup.send = lambda data, name, caption="": (calls.append(name) or (True, "HTTP 200"))

main._offbox_backup_tick()
assert len(calls) == 1, calls
main._offbox_backup_tick()          # same day -> must not send again
assert len(calls) == 1, calls
with db.get_conn() as conn:         # pretend a day passed
    conn.execute("UPDATE settings SET value='2000-01-01' WHERE key='last_offbox_backup'")
main._offbox_backup_tick()
assert len(calls) == 2, calls

# success stamps last_backup_at so the admin nudge reflects auto-backups
with db.get_conn() as conn:
    stamp = conn.execute("SELECT value FROM settings WHERE key='last_backup_at'").fetchone()
assert stamp and stamp["value"], "last_backup_at should be stamped on success"

print("ok")
