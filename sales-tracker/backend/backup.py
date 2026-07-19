"""Off-box backup delivery to a private Telegram chat — stdlib only (urllib).

Railway's own volume backups already cover volume loss/corruption. This is the
second layer: a copy that lives OUTSIDE Railway entirely, so it survives losing
the Railway account itself (compromise, billing lapse).

Dormant unless both env vars are set, so it is safe to deploy before the bot
exists:
  SALESPAL_BACKUP_TG_TOKEN  - bot token from @BotFather
  SALESPAL_BACKUP_TG_CHAT   - chat id to send to (your own chat with the bot)

The token is a secret: it is never logged, and only ever appears in the request
URL, which is not printed on failure.
"""
import os
import urllib.error
import urllib.request
import uuid

TG_MAX = 50 * 1024 * 1024  # Telegram's sendDocument size cap


def _token():
    return os.environ.get("SALESPAL_BACKUP_TG_TOKEN", "").strip()


def _chat():
    return os.environ.get("SALESPAL_BACKUP_TG_CHAT", "").strip()


def configured():
    return bool(_token() and _chat())


def _multipart(fields, filename, data):
    """Build a multipart/form-data body by hand (stdlib only, like billing.py)."""
    boundary = "----salespal" + uuid.uuid4().hex
    body = b""
    for k, v in fields.items():
        body += (f"--{boundary}\r\n"
                 f'Content-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n').encode()
    body += (f"--{boundary}\r\n"
             f'Content-Disposition: form-data; name="document"; filename="{filename}"\r\n'
             "Content-Type: application/octet-stream\r\n\r\n").encode()
    body += data + f"\r\n--{boundary}--\r\n".encode()
    return boundary, body


def send(data, filename, caption=""):
    """Ship one backup. Returns (ok, detail) — never raises, so a failed backup
    can never take the app down; the caller logs the detail."""
    if not configured():
        return False, "not configured (SALESPAL_BACKUP_TG_TOKEN / _CHAT unset)"
    if len(data) > TG_MAX:
        return False, f"backup is {len(data) // 1048576}MB, over Telegram's 50MB limit"
    boundary, body = _multipart(
        {"chat_id": _chat(), "caption": caption}, filename, data)
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{_token()}/sendDocument",
        data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return (200 <= r.status < 300), f"HTTP {r.status}"
    except urllib.error.HTTPError as e:
        # Telegram's error body explains the cause (bad chat_id, revoked token).
        # It does not echo the token, so this is safe to surface.
        detail = e.read()[:200].decode("utf-8", "replace")
        return False, f"HTTP {e.code}: {detail}"
    except Exception as e:  # network down, DNS, timeout
        return False, repr(e)
