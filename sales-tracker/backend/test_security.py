"""Runnable checks for the security backstops: the daily AI spend cap and
server-side session expiry. Run: python test_security.py"""
import os, tempfile
from datetime import datetime, timedelta
os.environ["SALESPAL_DB"] = tempfile.mkstemp(suffix=".db")[1]

import db; db.init_db()
import ai

# ---- daily AI spend cap: stops exactly at the ceiling ----
ai.DAILY_CAP = 3
assert ai._over_cap() is False   # 1st call allowed (count 0 -> 1)
assert ai._over_cap() is False   # 2nd (1 -> 2)
assert ai._over_cap() is False   # 3rd (2 -> 3)
assert ai._over_cap() is True    # 4th: count is now 3 >= cap -> blocked
assert ai._over_cap() is True    # stays blocked

ai.DAILY_CAP = 0                 # 0 disables the cap entirely
assert ai._over_cap() is False

# ---- session expiry: a cookie older than the TTL is rejected ----
with db.get_conn() as conn:
    conn.execute("INSERT INTO users(email,pw_hash,pw_salt,created_at) VALUES(?,?,?,?)",
                 ("a@t.co", "h", "s", db.now_iso()))
    uid = conn.execute("SELECT id FROM users WHERE email='a@t.co'").fetchone()["id"]
    db.create_session(conn, "fresh", uid)
    db.create_session(conn, "stale", uid)
    old = (datetime.utcnow() - timedelta(days=db.SESSION_TTL_DAYS + 1)).isoformat()
    conn.execute("UPDATE sessions SET created_at=? WHERE token='stale'", (old,))

with db.get_conn() as conn:
    assert db.user_for_session(conn, "fresh") is not None
    assert db.user_for_session(conn, "stale") is None
    assert db.user_for_session(conn, "nonexistent") is None
    assert db.user_for_session(conn, None) is None

print("ok")
