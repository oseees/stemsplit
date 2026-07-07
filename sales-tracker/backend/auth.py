"""Authentication helpers for SalesPal — stdlib only (no external crypto deps).

Password hashing uses PBKDF2-HMAC-SHA256; sessions are server-side rows keyed
by a random token stored in an HttpOnly cookie.
"""
import hashlib
import hmac
import secrets

from fastapi import Request, HTTPException

import db

COOKIE_NAME = "sp_session"
_ITERATIONS = 200_000


def hash_pw(password: str, salt: str) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                             bytes.fromhex(salt), _ITERATIONS)
    return dk.hex()


def new_salt() -> str:
    return secrets.token_hex(16)


def new_token() -> str:
    return secrets.token_hex(32)


def verify_pw(password: str, salt: str, expected_hash: str) -> bool:
    return hmac.compare_digest(hash_pw(password, salt), expected_hash)


def current_user(request: Request):
    """FastAPI dependency: resolve the logged-in user from the session cookie.

    For an attendant session the returned dict is still the OWNER's user row
    (so every user_id-scoped query is unchanged), but flagged is_attendant and
    hard-locked to the attendant's shop."""
    token = request.cookies.get(COOKIE_NAME)
    with db.get_conn() as conn:
        row = db.user_for_session(conn, token)
    if row is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    d = dict(row)
    if d.get("staff_id"):
        d["is_attendant"] = True
        d["active_shop_id"] = d.get("staff_shop_id") or 0  # locked to their shop
    else:
        d["is_attendant"] = False
    return d
