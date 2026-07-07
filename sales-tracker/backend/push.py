"""Web-push notifications (new-order alerts).

Self-contained: VAPID keys are generated on first use and stored in the global
settings table on the data volume — no external service or env vars needed.
Degrades silently: if pywebpush is missing or a send fails, the app carries on.
"""
import json
import threading

import db

_CLAIMS = {"sub": "mailto:oseabhi@gmail.com"}
_lock = threading.Lock()


def _pem():
    """The server's VAPID private key (PEM), created once and persisted."""
    with _lock, db.get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='vapid_pem'").fetchone()
        if row:
            return row["value"]
        from py_vapid import Vapid
        v = Vapid()
        v.generate_keys()
        pem = v.private_pem().decode()
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('vapid_pem',?)", (pem,))
        return pem


def public_key():
    """applicationServerKey for the browser (base64url uncompressed point)."""
    from py_vapid import Vapid, b64urlencode
    from cryptography.hazmat.primitives import serialization
    v = Vapid.from_pem(_pem().encode())
    return b64urlencode(v.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))


def _send_all(user_id, payload):
    from pywebpush import webpush, WebPushException
    from py_vapid import Vapid
    # A Vapid OBJECT, not the PEM string: pywebpush treats a str as a raw
    # base64 key and blows up on PEM (the bug that silently ate every send).
    vapid = Vapid.from_pem(_pem().encode())
    with db.get_conn() as conn:
        subs = conn.execute(
            "SELECT id, sub FROM push_subs WHERE user_id=?", (user_id,)).fetchall()
    for row in subs:
        try:
            # ttl: let the push service queue for a day if the phone is
            # offline/dozing (ttl=0 means "deliver this instant or drop").
            webpush(subscription_info=json.loads(row["sub"]), data=payload,
                    vapid_private_key=vapid, vapid_claims=dict(_CLAIMS),
                    ttl=86400, timeout=10)
        except WebPushException as e:
            # 404/410 = the browser dropped the subscription — forget it
            if e.response is not None and e.response.status_code in (404, 410):
                with db.get_conn() as conn:
                    conn.execute("DELETE FROM push_subs WHERE id=?", (row["id"],))
            else:
                print(f"[push] send failed for user {user_id}: {e}", flush=True)
        except Exception as e:
            # never let a push break anything — but SAY SO in the server logs
            print(f"[push] error for user {user_id}: {e!r}", flush=True)


def notify(user_id, title, body, url="/app/"):
    """Fire-and-forget push to all of a user's devices (background thread)."""
    payload = json.dumps({"title": title, "body": body, "url": url})
    threading.Thread(target=_send_all, args=(user_id, payload), daemon=True).start()
