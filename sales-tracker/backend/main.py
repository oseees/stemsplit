"""SalesPal — sales, profit, invoice, expense & payment tracker. FastAPI backend.

Multi-tenant: every data endpoint is scoped to the signed-in user via the
`current_user` dependency; rows carry a user_id and queries filter on it.
"""
import os
import re
import hmac
import json
import asyncio
from datetime import datetime, timedelta, date

# Load .env if present (no python-dotenv dependency needed)
_env = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env):
    for line in open(_env):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from fastapi import FastAPI, HTTPException, Body, Depends, Request, Response, UploadFile, File
from fastapi.responses import Response as RawResponse, FileResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List

import db
import ai
import auth
import billing
import push
from auth import current_user
from pdf import build_invoice_pdf
import imgdoc

app = FastAPI(title="SalesPal")
db.init_db()


# --- per-IP rate limiting -------------------------------------------------
# Stdlib sliding window: auth endpoints are the brute-force / credential-stuffing
# surface, the AI/voice endpoints cost real money per call. No slowapi/Redis —
# a dict of IP->timestamps is plenty at this scale.
# ponytail: in-memory, so limits reset on redeploy, aren't shared across
# replicas, and idle IPs keep a small dict entry (bounded by active-IP count).
# Single Railway instance today. Move to Redis if we scale out.
import time
from collections import deque

_RATE_HITS = {}
# (path prefix, max hits, window seconds) — first matching prefix wins.
_RATE_RULES = [
    ("/api/auth/login", 10, 60),
    ("/api/auth/register", 5, 60),
    ("/api/auth/reset", 5, 60),
    ("/api/voice/", 20, 60),
]


def _client_ip(request):
    # Railway terminates TLS and sets X-Forwarded-For; take the leftmost (client).
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip()
            or (request.client.host if request.client else "?"))


def _rate_limited(request):
    path = request.url.path
    for prefix, limit, window in _RATE_RULES:
        if path.startswith(prefix):
            now = time.monotonic()
            key = prefix + ":" + _client_ip(request)
            dq = _RATE_HITS.setdefault(key, deque())
            while dq and now - dq[0] > window:
                dq.popleft()
            if len(dq) >= limit:
                return window
            dq.append(now)
            return 0
    return 0


@app.middleware("http")
async def _rate_limit(request: Request, call_next):
    retry = _rate_limited(request)
    if retry:
        return JSONResponse({"detail": "Too many requests — slow down and try again shortly."},
                            status_code=429, headers={"Retry-After": str(retry)})
    return await call_next(request)


@app.middleware("http")
async def _security_headers(request: Request, call_next):
    """Baseline hardening headers on every response. CSP is intentionally
    omitted: the app relies on inline scripts/handlers, so a useful policy
    would need a nonce pipeline — revisit if that ever changes."""
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    # microphone=(self): voice sale entry needs getUserMedia on our own origin.
    # A bare microphone=() disables the mic for EVERYONE incl. self, which silently
    # kills getUserMedia in every browser/WebView regardless of OS permission.
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(self), geolocation=()")
    # HSTS only matters over https; Railway terminates TLS in front of us.
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return resp


# Deny-by-default allowlist for attendant (staff) sessions. Enforced centrally so
# a new profit/settings endpoint can never accidentally leak to attendants — they
# can ONLY reach the paths below (record sales, see stock, send receipts).
_ATTENDANT_ALLOW = [
    ("GET", re.compile(r"^/api/auth/me$")),
    ("POST", re.compile(r"^/api/auth/login$")),
    ("POST", re.compile(r"^/api/auth/logout$")),
    ("GET", re.compile(r"^/api/settings$")),
    ("GET", re.compile(r"^/api/shops$")),
    ("GET", re.compile(r"^/api/products$")),
    ("GET", re.compile(r"^/api/customers$")),
    ("POST", re.compile(r"^/api/customers$")),
    ("GET", re.compile(r"^/api/invoices$")),
    ("POST", re.compile(r"^/api/invoices$")),
    ("GET", re.compile(r"^/api/invoices/\d+$")),
    ("GET", re.compile(r"^/api/invoices/\d+/(receipt|image|pdf)$")),
    ("POST", re.compile(r"^/api/invoices/\d+/payments$")),
]


def _attendant_allowed(method, path):
    return any(m == method and rx.match(path) for m, rx in _ATTENDANT_ALLOW)


@app.middleware("http")
async def _attendant_guard(request: Request, call_next):
    # ponytail: one indexed sessions lookup per API call for logged-in users;
    # fine at this scale — cache the staff flag on the token if it ever bites.
    path = request.url.path
    if path.startswith("/api/") and not _attendant_allowed(request.method, path):
        token = request.cookies.get(auth.COOKIE_NAME)
        if token:
            with db.get_conn() as conn:
                r = conn.execute("SELECT staff_id FROM sessions WHERE token=?", (token,)).fetchone()
            if r and r["staff_id"]:
                return JSONResponse({"detail": "Attendants can't access this"}, status_code=403)
    return await call_next(request)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


# ----------------------------- Models ---------------------------------------
class RegisterIn(BaseModel):
    email: str
    password: str
    business_name: Optional[str] = None
    name: Optional[str] = None
    # First-touch acquisition captured by the landing/app on first visit.
    referrer: Optional[str] = None   # document.referrer of the first page seen
    utm_source: Optional[str] = None  # ?utm_source= on the first visit, if any
    ref: Optional[str] = None        # a friend's referral code (?ref= on first visit)


class LoginIn(BaseModel):
    email: str
    password: str


class ResetIn(BaseModel):
    email: str
    token: str
    new_password: str


class ChangePwIn(BaseModel):
    current_password: str
    new_password: str


class GrantProIn(BaseModel):
    email: str
    plan: Optional[str] = "pro"


class StaffIn(BaseModel):
    name: Optional[str] = None
    username: str
    password: str
    shop_id: Optional[int] = None


class StaffUpdateIn(BaseModel):
    shop_id: int
    name: Optional[str] = None


class CheckoutIn(BaseModel):
    plan: Optional[str] = "monthly"


class ShopIn(BaseModel):
    name: Optional[str] = ""


class ActiveShopIn(BaseModel):
    shop_id: int = 0


class Supplier(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None


class Product(BaseModel):
    name: str
    sku: Optional[str] = None
    unit_price: float = 0
    unit_cost: float = 0
    stock_qty: float = 0
    low_stock_at: float = 0
    # A product can be reordered from several suppliers. When present on a
    # create/update, the whole list replaces the product's saved suppliers.
    suppliers: Optional[List[Supplier]] = None


class Customer(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None


class InvoiceItemIn(BaseModel):
    product_id: Optional[int] = None
    description: str
    qty: float = 1
    unit_price: float = 0
    unit_cost: float = 0


class PaymentIn(BaseModel):
    amount: float
    date: Optional[str] = None
    method: Optional[str] = None
    note: Optional[str] = None


class InvoiceIn(BaseModel):
    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    date: Optional[str] = None
    due_date: Optional[str] = None
    notes: Optional[str] = None
    items: List[InvoiceItemIn]
    # Offline support: a client-generated id makes replay idempotent (a sale
    # queued offline and retried on reconnect is created at most once), and an
    # optional bundled payment records "paid on the spot" in the same request so
    # the offline queue never holds a payment pointing at a not-yet-synced id.
    client_uid: Optional[str] = None
    payment: Optional[PaymentIn] = None


class ExpenseIn(BaseModel):
    category: Optional[str] = "General"
    amount: float
    date: Optional[str] = None
    description: Optional[str] = None


class BankResolveIn(BaseModel):
    account_number: str
    bank_code: str


class PayConnectIn(BaseModel):
    account_number: str
    bank_code: str


class TransferSetIn(BaseModel):
    enabled: bool = True
    account_name: Optional[str] = ""
    account_number: Optional[str] = ""
    bank: Optional[str] = ""


class ClaimIn(BaseModel):
    amount: Optional[float] = None
    note: Optional[str] = None


class OrderLineIn(BaseModel):
    product_id: int
    qty: float = 1


class PlaceOrderIn(BaseModel):
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    note: Optional[str] = None
    items: List[OrderLineIn]


# ----------------------------- Helpers --------------------------------------
def today():
    return date.today().isoformat()


def paid_for(conn, invoice_id):
    row = conn.execute(
        "SELECT COALESCE(SUM(amount),0) p FROM payments WHERE invoice_id=?",
        (invoice_id,),
    ).fetchone()
    return row["p"]


def cash_paid_for(conn, invoice_id):
    """How much of this invoice was paid in cash (method contains "cash",
    case-insensitive — covers the controlled "Cash" value and free-typed
    variants like "cash payment")."""
    row = conn.execute(
        "SELECT COALESCE(SUM(amount),0) p FROM payments "
        "WHERE invoice_id=? AND lower(method) LIKE '%cash%'",
        (invoice_id,),
    ).fetchone()
    return row["p"]


def status_for(total, paid):
    if paid <= 0.001:
        return "unpaid"
    if paid + 0.001 >= total:
        return "paid"
    return "partial"


def next_invoice_no(conn, user_id):
    # MAX+1, not COUNT+1: counting re-issues an existing number after a delete.
    row = conn.execute(
        "SELECT COALESCE(MAX(CAST(substr(invoice_no, 5) AS INTEGER)), 1000) m "
        "FROM invoices WHERE user_id=?", (user_id,)).fetchone()
    return f"INV-{max(row['m'], 1000) + 1}"


def _owned_invoice(conn, iid, user_id):
    inv = conn.execute(
        "SELECT * FROM invoices WHERE id=? AND user_id=?", (iid, user_id)).fetchone()
    if not inv:
        raise HTTPException(404, "Invoice not found")
    return inv


# ----------------------------- Plans / paywall ------------------------------
FREE_MAX_INVOICES_PER_MONTH = 15
FREE_MAX_PRODUCTS = 20
FREE_VOICE_USES_PER_MONTH = 5  # taste of voice sale entry before the paywall

# Pro pricing. Each plan buys a fixed stretch of Pro time; paying again extends
# it. Amounts are in kobo (₦1 = 100 kobo). To change a price or duration, edit
# the numbers here — nothing else needs to change.
PLANS = {
    "monthly":   {"price_kobo":  300000, "days":  30, "naira": "₦3,000",  "label": "Monthly"},
    "yearly":    {"price_kobo": 3000000, "days": 365, "naira": "₦30,000", "label": "Yearly"},
    # Early bird: founding-member rate, locked in for these users on renewal,
    # offered only to the first EARLY_BIRD_SLOTS paying customers.
    "earlybird": {"price_kobo": 2000000, "days": 365, "naira": "₦20,000", "label": "Early Bird"},
}
EARLY_BIRD_SLOTS = 50
PRO_PRICE_KOBO = PLANS["monthly"]["price_kobo"]  # back-compat (lowest price)
PRO_DAYS = PLANS["monthly"]["days"]


def _early_bird_claimed(conn):
    return conn.execute(
        "SELECT COUNT(*) c FROM users WHERE early_bird=1").fetchone()["c"]


def _early_bird_remaining(conn):
    return max(0, EARLY_BIRD_SLOTS - _early_bird_claimed(conn))


def _public_plans(conn):
    """Plan list for the pricing UI (landing page + upgrade modal)."""
    remaining = _early_bird_remaining(conn)
    return {
        "billing_enabled": billing.enabled(),
        "early_bird_remaining": remaining,
        "early_bird_slots": EARLY_BIRD_SLOTS,
        "plans": [
            {"key": "monthly", "naira": PLANS["monthly"]["naira"], "days": 30,
             "label": "Monthly", "per": "/month"},
            {"key": "yearly", "naira": PLANS["yearly"]["naira"], "days": 365,
             "label": "Yearly", "per": "/year", "save": "2 months free"},
            {"key": "earlybird", "naira": PLANS["earlybird"]["naira"], "days": 365,
             "label": "Early Bird", "per": "/year",
             "save": "Founding rate · locked in", "remaining": remaining,
             "available": remaining > 0},
        ],
    }


def _owner_email():
    return os.environ.get("SALESPAL_OWNER_EMAIL", "").strip().lower()


def _is_owner(user):
    email = (user.get("email") or "").strip().lower()
    return bool(_owner_email()) and email == _owner_email()


def is_pro(user):
    """Pro access: the owner is always Pro; otherwise plan=='pro' or an
    unexpired plan_expires_at (reserved for Phase 2 billing)."""
    email = (user.get("email") or "").strip().lower()
    if email and email == _owner_email():
        return True
    if user.get("plan") == "pro":
        return True
    exp = user.get("plan_expires_at")
    return bool(exp) and exp >= today()


def _month_start():
    return date.today().replace(day=1).isoformat()


def _invoices_this_month(conn, user_id):
    return conn.execute(
        "SELECT COUNT(*) c FROM invoices WHERE user_id=? AND created_at >= ?",
        (user_id, _month_start())).fetchone()["c"]


def _outstanding_total(conn, user_id):
    # Total still owed across all this user's invoices (matches the frontend's
    # sum of per-invoice balances) — powers the paywall's "you're owed ₦X" hook.
    row = conn.execute(
        "SELECT COALESCE(SUM(bal),0) t FROM ("
        "  SELECT i.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=i.id),0) bal"
        "  FROM invoices i WHERE i.user_id=?"
        ") WHERE bal > 0.01", (user_id,)).fetchone()
    return round(row["t"] or 0, 2)


def _plan_info(conn, user):
    pro = is_pro(user)
    prod = conn.execute(
        "SELECT COUNT(*) c FROM products WHERE user_id=?", (user["id"],)).fetchone()["c"]
    return {
        "plan": "pro" if pro else "free",
        "is_pro": pro,
        "is_owner": _is_owner(user),
        "plan_expires_at": user.get("plan_expires_at"),
        "billing_enabled": billing.enabled(),
        "early_bird": bool(user.get("early_bird")),
        "pricing": _public_plans(conn),
        "usage": {
            "invoices_this_month": _invoices_this_month(conn, user["id"]),
            "products": prod,
            "outstanding_total": _outstanding_total(conn, user["id"]),
        },
        "limits": {
            "invoices_per_month": FREE_MAX_INVOICES_PER_MONTH,
            "products": FREE_MAX_PRODUCTS,
        },
    }


@app.get("/api/plan")
def get_plan(user=Depends(current_user)):
    with db.get_conn() as conn:
        return _plan_info(conn, user)


@app.get("/api/pricing")
def get_pricing():
    """Public — powers the pre-login landing/pricing page (no auth needed)."""
    with db.get_conn() as conn:
        return _public_plans(conn)


@app.post("/api/admin/grant-pro")
def grant_pro(data: GrantProIn, user=Depends(current_user)):
    """Owner-only: comp (or revoke) Pro for a given account without billing."""
    email = (user.get("email") or "").strip().lower()
    if not _owner_email() or email != _owner_email():
        raise HTTPException(403, "Not allowed")
    target = (data.email or "").strip().lower()
    plan = "free" if data.plan == "free" else "pro"
    with db.get_conn() as conn:
        u = db.get_user_by_email(conn, target)
        if not u:
            raise HTTPException(404, "No account with that email")
        conn.execute("UPDATE users SET plan=? WHERE id=?", (plan, u["id"]))
    return {"ok": True, "email": target, "plan": plan}


@app.get("/api/admin/backup")
def admin_backup(user=Depends(current_user)):
    """Owner-only: download a consistent snapshot of the entire database."""
    if not _is_owner(user):
        raise HTTPException(403, "Not allowed")
    data = db.backup_bytes()
    # remember when the last backup was taken (drives the >7-days admin nudge)
    with db.get_conn() as conn:
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('last_backup_at',?)",
                     (db.now_iso(),))
    return RawResponse(
        data, media_type="application/octet-stream",
        headers={"Content-Disposition":
                 f'attachment; filename="salespal-backup-{date.today().isoformat()}.db"'})


@app.get("/api/admin/stats")
def admin_stats(user=Depends(current_user)):
    """Owner-only usage dashboard: how many accounts exist, have signed in, and pay."""
    if not _is_owner(user):
        raise HTTPException(403, "Not allowed")
    d7 = (date.today() - timedelta(days=7)).isoformat()
    d30 = (date.today() - timedelta(days=30)).isoformat()
    with db.get_conn() as conn:
        one = lambda q, p=(): conn.execute(q, p).fetchone()[0]
        total = one("SELECT COUNT(*) FROM users")
        # accounts that have ever signed in (register or login stamps last_login_at)
        logged_in = one("SELECT COUNT(*) FROM users WHERE last_login_at IS NOT NULL")
        active_sessions = one("SELECT COUNT(DISTINCT user_id) FROM sessions")
        pro = one("SELECT COUNT(*) FROM users WHERE plan='pro' OR (plan_expires_at IS NOT NULL AND plan_expires_at >= ?)", (today(),))
        signups_7d = one("SELECT COUNT(*) FROM users WHERE created_at >= ?", (d7,))
        signups_30d = one("SELECT COUNT(*) FROM users WHERE created_at >= ?", (d30,))
        active_7d = one("SELECT COUNT(*) FROM users WHERE last_login_at >= ?", (d7,))
        shops = one("SELECT COUNT(*) FROM shops")
        invoices = one("SELECT COUNT(*) FROM invoices")
        # where signups came from (first-touch); label NULLs from before tracking
        sources = [{"source": (r[0] or "unknown"), "count": r[1]} for r in conn.execute(
            "SELECT signup_source, COUNT(*) c FROM users "
            "GROUP BY signup_source ORDER BY c DESC").fetchall()]
        recent = [dict(r) for r in conn.execute(
            "SELECT email, business_name, plan, created_at, last_login_at, signup_source "
            "FROM users ORDER BY id DESC LIMIT 20").fetchall()]
        lb = conn.execute("SELECT value FROM settings WHERE key='last_backup_at'").fetchone()
    return {
        "last_backup_at": lb["value"] if lb else None,
        "total_accounts": total,
        "signed_in_accounts": logged_in,
        "active_sessions": active_sessions,
        "pro_accounts": pro,
        "signups_7d": signups_7d,
        "signups_30d": signups_30d,
        "active_7d": active_7d,
        "total_shops": shops,
        "total_invoices": invoices,
        "sources": sources,
        "recent": recent,
    }


# ----------------------------- Billing (Paystack) ---------------------------
def _grant_days(conn, user_id, days):
    """Credit `days` of Pro access, stacking onto any remaining time."""
    row = conn.execute("SELECT plan_expires_at FROM users WHERE id=?", (user_id,)).fetchone()
    base = date.today()
    cur_exp = row["plan_expires_at"] if row else None
    if cur_exp:
        try:
            d = date.fromisoformat(cur_exp[:10])
            if d > base:
                base = d  # stack onto remaining time
        except Exception:
            pass
    new_exp = (base + timedelta(days=int(days))).isoformat()
    conn.execute("UPDATE users SET plan_expires_at=? WHERE id=?", (new_exp, user_id))


# Referral program: invite a shop owner, you both get a free month of Pro.
# The new account gets theirs at signup; the inviter earns theirs when the
# new account records its FIRST sale (rewards real usage, not throwaway
# signups — combined with the register rate limit, farming isn't worth it).
REFERRAL_DAYS = 30
REFERRAL_CAP = 12  # max rewarded referrals per inviter


def _ref_code(conn, user_id):
    """The user's shareable referral code, created on first ask."""
    row = conn.execute("SELECT ref_code FROM users WHERE id=?", (user_id,)).fetchone()
    if row and row["ref_code"]:
        return row["ref_code"]
    import secrets as _secrets
    while True:  # unambiguous alphabet (no 0/O/1/I)
        code = "".join(_secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
        if not conn.execute("SELECT 1 FROM users WHERE ref_code=?", (code,)).fetchone():
            break
    conn.execute("UPDATE users SET ref_code=? WHERE id=?", (code, user_id))
    return code


@app.get("/api/referral")
def referral_info(user=Depends(current_user)):
    with db.get_conn() as conn:
        code = _ref_code(conn, user["id"])
        joined = conn.execute("SELECT COUNT(*) FROM users WHERE referred_by=?",
                              (user["id"],)).fetchone()[0]
        rewarded = conn.execute(
            "SELECT COUNT(*) FROM users WHERE referred_by=? AND ref_rewarded=1",
            (user["id"],)).fetchone()[0]
    return {"code": code, "link": f"https://salespal.online/?ref={code}",
            "joined": joined, "months_earned": rewarded,
            "days_per_referral": REFERRAL_DAYS}


def _apply_plan(conn, user_id, reference, amount, days, plan_key=None):
    """Idempotently credit `days` of Pro. Returns True only on first apply.
    Early-bird purchases also flag the user so their founding rate is kept."""
    cur = conn.execute(
        "INSERT OR IGNORE INTO billing_events(reference,user_id,amount,created_at) "
        "VALUES(?,?,?,?)", (reference, user_id, amount, db.now_iso()))
    if cur.rowcount == 0:
        return False  # already processed this reference
    _grant_days(conn, user_id, days)
    if plan_key == "earlybird":
        conn.execute("UPDATE users SET early_bird=1 WHERE id=?", (user_id,))
    return True


@app.post("/api/billing/checkout")
def billing_checkout(data: CheckoutIn, request: Request, user=Depends(current_user)):
    if not billing.enabled():
        raise HTTPException(503, "Billing isn't set up yet")
    plan_key = (data.plan or "monthly").strip()
    plan = PLANS.get(plan_key)
    if not plan:
        raise HTTPException(400, "Unknown plan")
    with db.get_conn() as conn:
        if plan_key == "earlybird":
            # Founding rate is limited; existing founders can always renew at it.
            u = db.get_user(conn, user["id"])
            already = bool(u and u["early_bird"])
            if not already and _early_bird_remaining(conn) <= 0:
                raise HTTPException(409, "The early-bird offer is sold out")
    import secrets as _secrets
    reference = "sp_" + _secrets.token_hex(10)
    callback_url = str(request.base_url).rstrip("/") + "/app/?paid=1"
    try:
        res = billing.init_transaction(
            user["email"], plan["price_kobo"], reference, callback_url,
            {"user_id": user["id"], "purpose": "pro", "plan": plan_key})
    except Exception:
        raise HTTPException(502, "Couldn't reach the payment provider")
    if not res.get("status"):
        raise HTTPException(502, res.get("message") or "Payment couldn't be started")
    return {"authorization_url": res["data"]["authorization_url"], "reference": reference}


def _plan_from_amount(amount):
    """Map a paid amount back to the most generous plan it fully covers."""
    best = None
    for key, p in PLANS.items():
        if amount >= p["price_kobo"]:
            if best is None or p["days"] > PLANS[best]["days"]:
                best = key
    return best


def _grant_from_paystack_data(conn, data):
    """Apply Pro from a verified Paystack transaction payload. Returns bool."""
    if not data or data.get("status") != "success":
        return False
    amount = int(data.get("amount") or 0)
    if amount < PRO_PRICE_KOBO:
        return False  # underpayment — never unlock
    meta = data.get("metadata") or {}
    # Trust the plan we set at checkout, but require the amount to actually
    # cover it; otherwise fall back to whatever the amount paid covers.
    plan_key = meta.get("plan")
    if plan_key not in PLANS or amount < PLANS[plan_key]["price_kobo"]:
        plan_key = _plan_from_amount(amount)
    if not plan_key:
        return False
    days = PLANS[plan_key]["days"]
    uid = meta.get("user_id")
    if not uid:  # fallback: match by customer email
        email = ((data.get("customer") or {}).get("email") or "").strip().lower()
        u = db.get_user_by_email(conn, email) if email else None
        uid = u["id"] if u else None
    if not uid:
        return False
    return _apply_plan(conn, uid, data.get("reference"), amount, days, plan_key)


def _record_invoice_payment(conn, data):
    """Record a Paystack-settled invoice payment against its invoice.
    Idempotent: the Paystack reference is stored so replays are ignored."""
    if not data or data.get("status") != "success":
        return False
    ref = data.get("reference")
    meta = data.get("metadata") or {}
    iid = meta.get("invoice_id")
    if not ref or not iid:
        return False
    inv = conn.execute("SELECT * FROM invoices WHERE id=?", (iid,)).fetchone()
    if not inv:
        return False
    if conn.execute("SELECT 1 FROM payments WHERE paystack_ref=?", (ref,)).fetchone():
        return False  # already recorded this transaction
    amount = (int(data.get("amount") or 0)) / 100.0
    if amount <= 0:
        return False
    conn.execute(
        "INSERT INTO payments(invoice_id,amount,date,method,note,paystack_ref) "
        "VALUES(?,?,?,?,?,?)",
        (iid, amount, today(), "Paystack", "Paid online", ref))
    paid = paid_for(conn, iid)
    conn.execute("UPDATE invoices SET status=? WHERE id=?",
                 (status_for(inv["total"], paid), iid))
    return True


@app.post("/api/billing/webhook")
async def billing_webhook(request: Request):
    raw = await request.body()
    sig = request.headers.get("x-paystack-signature", "")
    if not billing.verify_webhook(raw, sig):
        raise HTTPException(401, "Bad signature")
    try:
        event = json.loads(raw.decode())
    except Exception:
        return {"ok": True}
    if event.get("event") == "charge.success":
        ref = (event.get("data") or {}).get("reference")
        v = billing.verify_transaction(ref) if ref else {}
        if v.get("status"):
            data = v.get("data")
            purpose = ((data or {}).get("metadata") or {}).get("purpose")
            with db.get_conn() as conn:
                if purpose == "invoice":
                    _record_invoice_payment(conn, data)
                else:
                    _grant_from_paystack_data(conn, data)
    return {"ok": True}


@app.get("/api/billing/verify")
def billing_verify(reference: str, user=Depends(current_user)):
    """Called when the user returns from Paystack — verify + apply instantly."""
    if not billing.enabled():
        raise HTTPException(503, "Billing isn't set up yet")
    v = billing.verify_transaction(reference)
    paid = False
    with db.get_conn() as conn:
        if v.get("status"):
            _grant_from_paystack_data(conn, v.get("data"))
        u = db.get_user(conn, user["id"])
        info = _plan_info(conn, dict(u))
        paid = info["is_pro"]
    info["paid"] = paid
    return info


# ----------------------------- Auth -----------------------------------------
def _public_user(u, staff=None, shop_name=None):
    """Safe user fields for the client. `u` may be a sqlite Row (login) or the
    current_user dict (/me). Attendants get is_attendant + their name & shop."""
    get = u.get if isinstance(u, dict) else (lambda k, d=None: u[k] if k in u.keys() else d)
    out = {"id": u["id"], "email": get("email"), "name": get("name"),
           "business_name": get("business_name")}
    if staff is not None or (isinstance(u, dict) and u.get("is_attendant")):
        out["is_attendant"] = True
        out["staff_name"] = (staff["name"] if staff else u.get("staff_name")) or "Attendant"
        out["shop_name"] = shop_name
    else:
        out["is_attendant"] = False
    return out


def _set_session_cookie(request: Request, response: Response, token: str):
    # Secure everywhere except plain-http localhost (so local dev still works).
    host = (request.url.hostname or "").lower()
    secure = host not in ("localhost", "127.0.0.1")
    response.set_cookie(
        auth.COOKIE_NAME, token, httponly=True, samesite="lax", secure=secure,
        path="/", max_age=60 * 60 * 24 * 365,
    )


_SEARCH_HOSTS = ("google.", "bing.", "yahoo.", "duckduckgo.", "ecosia.",
                 "yandex.", "baidu.", "ask.com")
_SOCIAL_HOSTS = ("facebook.", "fb.", "instagram.", "twitter.", "x.com", "t.co",
                 "tiktok.", "linkedin.", "lnkd.in", "youtube.", "youtu.be",
                 "whatsapp.", "wa.me", "pinterest.", "reddit.", "telegram.", "t.me")


def _classify_source(referrer, utm_source):
    """Bucket a signup's first-touch into a channel for the owner dashboard.
    An explicit utm_source wins; otherwise infer from the referrer host."""
    utm = (utm_source or "").strip().lower()
    if utm:
        if utm in ("google", "bing", "organic", "search"):
            return "search"
        if utm in ("facebook", "instagram", "twitter", "tiktok", "linkedin", "whatsapp", "social"):
            return "social"
        return utm[:40]
    ref = (referrer or "").strip().lower()
    if not ref:
        return "direct"
    host = ref.split("//", 1)[-1].split("/", 1)[0]
    if host.startswith("www."):
        host = host[4:]
    if "salespal.online" in host:
        return "direct"  # internal navigation, not a real acquisition source
    if any(h in host for h in _SEARCH_HOSTS):
        return "search"
    if any(h in host for h in _SOCIAL_HOSTS):
        return "social"
    return host[:40] or "direct"


@app.post("/api/auth/register")
def register(data: RegisterIn, request: Request, response: Response):
    email = (data.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "A valid email is required")
    if not data.password or len(data.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    with db.get_conn() as conn:
        if db.get_user_by_email(conn, email):
            raise HTTPException(400, "An account with this email already exists")
        # Claim the pre-accounts data only on a genuine upgrade (orphaned
        # single-tenant rows exist). If SALESPAL_OWNER_EMAIL is set, ONLY that
        # email may claim it — so a tester who signs up first on a shared link
        # can never inherit the owner's real business data. Without that env set
        # it falls back to "first account claims" (fine for fresh installs).
        owner_email = os.environ.get("SALESPAL_OWNER_EMAIL", "").strip().lower()
        legacy = db.has_legacy_data(conn)
        if owner_email:
            claim = legacy and email == owner_email
        else:
            claim = legacy and not db.has_users(conn)
        salt = auth.new_salt()
        uid = db.create_user(
            conn, email, (data.name or "").strip() or None,
            (data.business_name or "").strip() or "My Business",
            auth.hash_pw(data.password, salt), salt)
        conn.execute(
            "UPDATE users SET signup_source=?, signup_referrer=? WHERE id=?",
            (_classify_source(data.referrer, data.utm_source),
             (data.referrer or "")[:300] or None, uid))
        # Referral: signing up through a friend's link = 1 free month of Pro
        # now; the friend earns theirs when this account records its first sale.
        referral_bonus = False
        ref = (data.ref or "").strip().upper()
        if ref:
            r = conn.execute("SELECT id FROM users WHERE ref_code=?", (ref,)).fetchone()
            if r:
                conn.execute("UPDATE users SET referred_by=? WHERE id=?", (r["id"], uid))
                _grant_days(conn, uid, REFERRAL_DAYS)
                referral_bonus = True
        # The very first account on an upgraded instance inherits the
        # pre-accounts data (incl. the owner's real settings) so nothing is
        # lost. Claim first so those settings win over seeded defaults.
        if claim:
            db.claim_legacy_data(conn, uid)
        db.seed_user_settings(conn, uid, {
            "business_name": (data.business_name or "").strip(),
            "email": email})
        # Every account starts with one shop (its default); it becomes active.
        shop_id = db.create_shop(
            conn, uid, (data.business_name or "").strip() or "My Shop")
        if claim:  # move any inherited pre-accounts data into the default shop
            db.stamp_user_shop(conn, uid, shop_id)
        token = auth.new_token()
        db.create_session(conn, token, uid)
        conn.execute("UPDATE users SET last_login_at=? WHERE id=?", (db.now_iso(), uid))
        user = db.get_user(conn, uid)
    _set_session_cookie(request, response, token)
    out = _public_user(user)
    if referral_bonus:
        out["referral_bonus"] = True  # lets the app toast the free month
    return out


@app.post("/api/auth/login")
def login(data: LoginIn, request: Request, response: Response):
    ident = (data.email or "").strip().lower()
    with db.get_conn() as conn:
        # Owner logs in with their email; attendant with the username the owner
        # set (no @). Try the email first, then the staff username.
        u = db.get_user_by_email(conn, ident)
        if u and auth.verify_pw(data.password, u["pw_salt"], u["pw_hash"]):
            token = auth.new_token()
            db.create_session(conn, token, u["id"])
            conn.execute("UPDATE users SET last_login_at=? WHERE id=?", (db.now_iso(), u["id"]))
            _set_session_cookie(request, response, token)
            return _public_user(u)
        st = db.get_staff_by_username(conn, ident)
        if st and auth.verify_pw(data.password, st["pw_salt"], st["pw_hash"]):
            token = auth.new_token()
            db.create_session(conn, token, st["owner_id"], staff_id=st["id"])
            owner = db.get_user(conn, st["owner_id"])
            shop = db.get_shop(conn, st["shop_id"], st["owner_id"])
            _set_session_cookie(request, response, token)
            return _public_user(owner, staff=st, shop_name=(shop["name"] if shop else None))
    raise HTTPException(401, "Wrong login or password")


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(auth.COOKIE_NAME)
    with db.get_conn() as conn:
        db.delete_session(conn, token)
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@app.post("/api/auth/reset")
def reset_password(data: ResetIn, request: Request, response: Response):
    """Set a new password using a one-time reset code (the SALESPAL_RESET_TOKEN
    server secret). The code is required in addition to the email, so knowing the
    email alone is not enough. On success the user is signed straight in."""
    expected = os.environ.get("SALESPAL_RESET_TOKEN", "").strip()
    if not expected:
        raise HTTPException(403, "Password reset isn't enabled")
    if not data.token or not hmac.compare_digest(data.token.strip(), expected):
        raise HTTPException(403, "Invalid reset code")
    if not data.new_password or len(data.new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    email = (data.email or "").strip().lower()
    with db.get_conn() as conn:
        u = db.get_user_by_email(conn, email)
        if not u:
            raise HTTPException(404, "No account with that email")
        salt = auth.new_salt()
        conn.execute("UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?",
                     (auth.hash_pw(data.new_password, salt), salt, u["id"]))
        conn.execute("DELETE FROM sessions WHERE user_id=?", (u["id"],))  # log out old sessions
        token = auth.new_token()
        db.create_session(conn, token, u["id"])
        user = db.get_user(conn, u["id"])
    _set_session_cookie(request, response, token)
    return _public_user(user)


def _require_owner(user):
    if user.get("is_attendant"):
        raise HTTPException(403, "Attendants can't manage staff")


@app.get("/api/staff")
def staff_list(user=Depends(current_user)):
    _require_owner(user)
    with db.get_conn() as conn:
        return {"staff": db.rows_to_list(db.list_staff(conn, user["id"]))}


@app.post("/api/staff")
def staff_create(data: StaffIn, user=Depends(current_user)):
    """Owner creates a shop-attendant login tied to one shop."""
    _require_owner(user)
    username = (data.username or "").strip().lower()
    if len(username) < 3 or "@" in username or " " in username:
        raise HTTPException(400, "Username needs 3+ characters, no spaces or @")
    if not data.password or len(data.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    with db.get_conn() as conn:
        shop_id = data.shop_id or _write_shop(conn, user)
        if not db.get_shop(conn, shop_id, user["id"]):
            raise HTTPException(404, "Shop not found")
        if db.get_staff_by_username(conn, username) or db.get_user_by_email(conn, username):
            raise HTTPException(400, "That username is taken — pick another")
        salt = auth.new_salt()
        sid = db.create_staff(conn, user["id"], shop_id, (data.name or "").strip() or None,
                              username, auth.hash_pw(data.password, salt), salt)
    return {"id": sid, "username": username}


@app.put("/api/staff/{sid}")
def staff_update(sid: int, data: StaffUpdateIn, user=Depends(current_user)):
    """Reassign an attendant to a different shop (and optionally rename)."""
    _require_owner(user)
    with db.get_conn() as conn:
        if not db.get_shop(conn, data.shop_id, user["id"]):
            raise HTTPException(404, "Shop not found")
        name = (data.name or "").strip() or None if data.name is not None else None
        if not db.update_staff(conn, sid, user["id"], data.shop_id, name):
            raise HTTPException(404, "Staff not found")
    return {"ok": True, "shop_id": data.shop_id}


@app.delete("/api/staff/{sid}")
def staff_remove(sid: int, user=Depends(current_user)):
    _require_owner(user)
    with db.get_conn() as conn:
        if not db.delete_staff(conn, sid, user["id"]):
            raise HTTPException(404, "Staff not found")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user=Depends(current_user)):
    shop_name = None
    if user.get("is_attendant"):
        with db.get_conn() as conn:
            sh = db.get_shop(conn, _active_shop(user), user["id"])
        shop_name = sh["name"] if sh else None
    return _public_user(user, shop_name=shop_name)


@app.post("/api/auth/change-password")
def change_password(data: ChangePwIn, user=Depends(current_user)):
    """Change your own password while logged in (current password required).
    Keeps the current session valid so you stay signed in."""
    if not data.new_password or len(data.new_password) < 8:
        raise HTTPException(400, "New password must be at least 8 characters")
    with db.get_conn() as conn:
        u = db.get_user(conn, user["id"])
        if not auth.verify_pw(data.current_password, u["pw_salt"], u["pw_hash"]):
            raise HTTPException(403, "Current password is incorrect")
        salt = auth.new_salt()
        conn.execute("UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?",
                     (auth.hash_pw(data.new_password, salt), salt, u["id"]))
    return {"ok": True}


# ----------------------------- Settings -------------------------------------
@app.get("/api/settings")
def get_settings(user=Depends(current_user)):
    return db.get_settings(user["id"])


@app.put("/api/settings")
def put_settings(data: dict = Body(...), user=Depends(current_user)):
    return db.update_settings(user["id"], data)


# ----------------------------- Products -------------------------------------
def _attach_suppliers(conn, products):
    """Attach a `suppliers` list to each product dict (one query, no N+1)."""
    ids = [p["id"] for p in products]
    by_product = {}
    if ids:
        ph = ",".join("?" * len(ids))
        for r in conn.execute(
            f"SELECT id, product_id, name, phone FROM suppliers "
            f"WHERE product_id IN ({ph}) ORDER BY id", ids,
        ).fetchall():
            by_product.setdefault(r["product_id"], []).append(
                {"id": r["id"], "name": r["name"], "phone": r["phone"]})
    for p in products:
        p["suppliers"] = by_product.get(p["id"], [])
    return products


def _save_suppliers(conn, product_id, suppliers):
    """Replace a product's suppliers with the given list (skips empty rows)."""
    conn.execute("DELETE FROM suppliers WHERE product_id=?", (product_id,))
    for s in suppliers:
        name = (s.name or "").strip()
        phone = (s.phone or "").strip()
        if not name and not phone:
            continue
        conn.execute(
            "INSERT INTO suppliers(product_id,name,phone,created_at) VALUES(?,?,?,?)",
            (product_id, name or None, phone or None, db.now_iso()))


@app.get("/api/products")
def list_products(user=Depends(current_user)):
    sf, sp = _shop_and(_active_shop(user))
    with db.get_conn() as conn:
        products = db.rows_to_list(conn.execute(
            "SELECT * FROM products WHERE user_id=?" + sf + " ORDER BY name",
            [user["id"]] + sp).fetchall())
        products = _attach_suppliers(conn, products)
    # Attendants must never see cost/margin — strip unit_cost server-side (the
    # sale endpoint refills it from the DB, so profit stays correct but hidden).
    if user.get("is_attendant"):
        for p in products:
            p.pop("unit_cost", None)
    return products


@app.post("/api/products")
def create_product(p: Product, user=Depends(current_user)):
    with db.get_conn() as conn:
        if not is_pro(user):
            n = conn.execute("SELECT COUNT(*) c FROM products WHERE user_id=?",
                             (user["id"],)).fetchone()["c"]
            if n >= FREE_MAX_PRODUCTS:
                raise HTTPException(
                    402, f"Free plan limit reached ({FREE_MAX_PRODUCTS} products). "
                         "Upgrade to Pro for unlimited products.")
        cur = conn.execute(
            "INSERT INTO products(user_id,shop_id,name,sku,unit_price,unit_cost,stock_qty,low_stock_at,created_at)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (user["id"], _write_shop(conn, user), p.name, p.sku, p.unit_price,
             p.unit_cost, p.stock_qty, p.low_stock_at, db.now_iso()),
        )
        if p.suppliers is not None:
            _save_suppliers(conn, cur.lastrowid, p.suppliers)
        return {"id": cur.lastrowid}


# Product photos live beside the DB (the persisted volume on Railway).
PHOTOS_DIR = os.path.join(os.path.dirname(db.DB_PATH), "photos")
os.makedirs(PHOTOS_DIR, exist_ok=True)


def _owned_product(conn, pid, user_id):
    row = conn.execute(
        "SELECT * FROM products WHERE id=? AND user_id=?", (pid, user_id)).fetchone()
    if not row:
        raise HTTPException(404, "Product not found")
    return row


@app.post("/api/products/{pid}/photo")
async def upload_product_photo(pid: int, file: UploadFile = File(...),
                               user=Depends(current_user)):
    """Attach a photo to a product (shown on the promo flyer). The image is
    re-encoded server-side — a resized JPEG is stored, never the raw upload."""
    from PIL import Image as _PILImage
    import io as _io
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(400, "Image too large (max 10MB)")
    try:
        img = _PILImage.open(_io.BytesIO(raw))
        img = img.convert("RGB")
        img.thumbnail((480, 480))
    except Exception:
        raise HTTPException(400, "That file isn't a readable image")
    with db.get_conn() as conn:
        _owned_product(conn, pid, user["id"])
        name = f"{pid}.jpg"
        img.save(os.path.join(PHOTOS_DIR, name), "JPEG", quality=85)
        conn.execute("UPDATE products SET photo=? WHERE id=?", (name, pid))
    return {"ok": True, "photo": name}


@app.get("/api/products/{pid}/photo")
def product_photo(pid: int, user=Depends(current_user)):
    with db.get_conn() as conn:
        row = _owned_product(conn, pid, user["id"])
    path = os.path.join(PHOTOS_DIR, row["photo"] or "")
    if not row["photo"] or not os.path.exists(path):
        raise HTTPException(404, "No photo")
    return FileResponse(path, media_type="image/jpeg")


@app.delete("/api/products/{pid}/photo")
def remove_product_photo(pid: int, user=Depends(current_user)):
    with db.get_conn() as conn:
        row = _owned_product(conn, pid, user["id"])
        if row["photo"]:
            try:
                os.remove(os.path.join(PHOTOS_DIR, row["photo"]))
            except OSError:
                pass
        conn.execute("UPDATE products SET photo=NULL WHERE id=?", (pid,))
    return {"ok": True}


@app.put("/api/products/{pid}")
def update_product(pid: int, p: Product, user=Depends(current_user)):
    with db.get_conn() as conn:
        owned = conn.execute(
            "SELECT id FROM products WHERE id=? AND user_id=?", (pid, user["id"])).fetchone()
        if not owned:
            raise HTTPException(404, "Product not found")
        conn.execute(
            "UPDATE products SET name=?,sku=?,unit_price=?,unit_cost=?,stock_qty=?,low_stock_at=? "
            "WHERE id=? AND user_id=?",
            (p.name, p.sku, p.unit_price, p.unit_cost, p.stock_qty, p.low_stock_at,
             pid, user["id"]),
        )
        if p.suppliers is not None:
            _save_suppliers(conn, pid, p.suppliers)
    return {"ok": True}


@app.delete("/api/products/{pid}")
def delete_product(pid: int, user=Depends(current_user)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM products WHERE id=? AND user_id=?", (pid, user["id"]))
    return {"ok": True}


class VoiceSaleIn(BaseModel):
    transcript: str


def _voice_sale_from_transcript(user, transcript):
    """Shared core: a spoken-sale transcript → structured items grounded in the
    user's own catalog. Pro feature with a monthly free taste; the counter only
    counts successful parses so a flaky network never eats a free use."""
    transcript = (transcript or "").strip()
    if not transcript:
        raise HTTPException(400, "Say something first")
    if not ai.available():
        raise HTTPException(503, "Voice entry isn't available right now")
    pro = is_pro(user)
    month = _month_start()
    with db.get_conn() as conn:
        if not pro:
            row = conn.execute("SELECT voice_month, voice_uses FROM users WHERE id=?",
                               (user["id"],)).fetchone()
            used = row["voice_uses"] if (row and row["voice_month"] == month) else 0
            if used >= FREE_VOICE_USES_PER_MONTH:
                raise HTTPException(402, "You've used your 5 free voice sales this month — Pro is unlimited")
        sf, sp = _shop_and(_active_shop(user))
        products = db.rows_to_list(conn.execute(
            "SELECT id, name, unit_price FROM products WHERE user_id=?" + sf,
            (user["id"], *sp)))
        customers = [r["name"] for r in conn.execute(
            "SELECT name FROM customers WHERE user_id=?" + sf, (user["id"], *sp))]
    settings = db.get_settings(user["id"])

    result = ai.parse_sale(transcript, products, customers, settings["currency"])
    if not result["ok"]:
        raise HTTPException(503, "Couldn't understand that — please try again")

    free_left = None
    if not pro:
        with db.get_conn() as conn:
            conn.execute(
                "UPDATE users SET voice_uses = CASE WHEN voice_month=? THEN voice_uses+1 ELSE 1 END, "
                "voice_month=? WHERE id=?", (month, month, user["id"]))
            free_left = FREE_VOICE_USES_PER_MONTH - conn.execute(
                "SELECT voice_uses u FROM users WHERE id=?", (user["id"],)).fetchone()["u"]
    return {"sale": result["sale"], "transcript": transcript, "free_uses_left": free_left}


@app.post("/api/voice/parse-sale")
def voice_parse_sale(body: VoiceSaleIn, user=Depends(current_user)):
    """Browser path: the Web Speech API already produced the transcript on-device."""
    return _voice_sale_from_transcript(user, body.transcript)


@app.post("/api/voice/transcribe-sale")
async def voice_transcribe_sale(audio: UploadFile = File(...), user=Depends(current_user)):
    """App/iPhone path: the Web Speech API is blocked inside the Android TWA and
    unsupported on iOS Safari, so the app records audio and we transcribe it here
    (Groq Whisper) before the same catalog-grounded parse."""
    data = await audio.read()
    if not data:
        raise HTTPException(400, "No audio received — try again")
    if len(data) > 8_000_000:  # a spoken sale is a few hundred KB; cap runaway uploads
        raise HTTPException(413, "That recording is too long — keep it short")
    tr = ai.transcribe_audio(data, audio.filename, audio.content_type)
    if not tr["ok"]:
        raise HTTPException(503, tr.get("error") or "Couldn't hear that — try again")
    return _voice_sale_from_transcript(user, tr["text"])


class PriceCheckIn(BaseModel):
    new_price: float


@app.post("/api/products/{pid}/price-advice")
def price_advice(pid: int, body: PriceCheckIn, user=Depends(current_user)):
    """What happens if I change this product's price? Deterministic contribution-
    margin break-even math computed here (the proven pricing test: how much volume
    can I lose / must I gain to keep the same profit), then Claude turns it plus
    real sales history into advice on likely customer reaction."""
    if not is_pro(user):
        raise HTTPException(402, "Price advice is a Pro feature")
    new_price = round(body.new_price or 0, 2)
    if new_price <= 0:
        raise HTTPException(400, "Enter the new price")
    settings = db.get_settings(user["id"])
    with db.get_conn() as conn:
        p = conn.execute("SELECT * FROM products WHERE id=? AND user_id=?",
                         (pid, user["id"])).fetchone()
        if not p:
            raise HTTPException(404, "Product not found")
        since = (date.today() - timedelta(days=90)).isoformat()
        hist = conn.execute(
            "SELECT COALESCE(SUM(it.qty),0) units, COALESCE(SUM(it.qty*it.unit_price),0) revenue, "
            "COUNT(DISTINCT it.invoice_id) sales "
            "FROM invoice_items it JOIN invoices i ON i.id=it.invoice_id "
            "WHERE i.user_id=? AND it.product_id=? AND i.date >= ?",
            (user["id"], pid, since)).fetchone()

    cost, cur_price = p["unit_cost"] or 0, p["unit_price"] or 0
    cur_m, new_m = cur_price - cost, new_price - cost
    change_pct = round((new_price - cur_price) / cur_price * 100, 1) if cur_price else None
    math = {
        "current_price": cur_price, "new_price": new_price, "unit_cost": cost,
        "change_pct": change_pct,
        "current_margin": round(cur_m, 2),
        "new_margin": round(new_m, 2),
        "current_margin_pct": round(cur_m / cur_price * 100, 1) if cur_price else None,
        "new_margin_pct": round(new_m / new_price * 100, 1),
        "below_cost": new_m <= 0,
        "units_90d": hist["units"], "revenue_90d": hist["revenue"], "sales_90d": hist["sales"],
    }
    # Break-even volume shift to keep the SAME total profit (only meaningful when
    # both margins are positive): volume ratio = old margin / new margin.
    if cur_m > 0 and new_m > 0 and new_price != cur_price:
        ratio = cur_m / new_m
        if new_price > cur_price:
            math["can_lose_sales_pct"] = round((1 - ratio) * 100, 1)
        else:
            math["need_more_sales_pct"] = round((ratio - 1) * 100, 1)
        # In real units over the same 90 days, when there's history to scale.
        if hist["units"]:
            math["breakeven_units_90d"] = round(hist["units"] * ratio, 1)

    payload = dict(math)
    payload.update({
        "product_name": p["name"], "currency": settings["currency"],
        "stock_qty": p["stock_qty"],
    })
    return {"math": math, "ai": ai.price_advice(payload)}


# ----------------------------- Customers ------------------------------------
@app.get("/api/customers")
def list_customers(user=Depends(current_user)):
    sf, sp = _shop_and(_active_shop(user))
    with db.get_conn() as conn:
        return db.rows_to_list(conn.execute(
            "SELECT * FROM customers WHERE user_id=?" + sf + " ORDER BY name",
            [user["id"]] + sp).fetchall())


@app.post("/api/customers")
def create_customer(c: Customer, user=Depends(current_user)):
    with db.get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO customers(user_id,shop_id,name,email,phone,address,created_at) VALUES(?,?,?,?,?,?,?)",
            (user["id"], _write_shop(conn, user), c.name, c.email, c.phone, c.address, db.now_iso()),
        )
        return {"id": cur.lastrowid}


@app.put("/api/customers/{cid}")
def update_customer(cid: int, c: Customer, user=Depends(current_user)):
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE customers SET name=?,email=?,phone=?,address=? WHERE id=? AND user_id=?",
            (c.name, c.email, c.phone, c.address, cid, user["id"]),
        )
    return {"ok": True}


@app.delete("/api/customers/{cid}")
def delete_customer(cid: int, user=Depends(current_user)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM customers WHERE id=? AND user_id=?", (cid, user["id"]))
    return {"ok": True}


# ----------------------------- Invoices / Sales -----------------------------
def _invoice_payload(conn, inv):
    items = db.rows_to_list(
        conn.execute("SELECT * FROM invoice_items WHERE invoice_id=?", (inv["id"],)).fetchall())
    payments = db.rows_to_list(
        conn.execute("SELECT * FROM payments WHERE invoice_id=? ORDER BY date", (inv["id"],)).fetchall())
    customer = db.row_to_dict(
        conn.execute("SELECT * FROM customers WHERE id=?", (inv["customer_id"],)).fetchone()
    ) if inv["customer_id"] else None
    paid = sum(p["amount"] for p in payments)
    out = dict(inv)
    out["items"] = items
    out["payments"] = payments
    out["customer"] = customer
    out["paid"] = paid
    out["balance"] = inv["total"] - paid
    out["status"] = status_for(inv["total"], paid)
    out["claims"] = db.rows_to_list(conn.execute(
        "SELECT * FROM invoice_claims WHERE invoice_id=? AND status='pending' ORDER BY id",
        (inv["id"],)).fetchall())
    return out


def _payments_ready(user):
    card = bool(user.get("pay_enabled") and user.get("pay_subaccount"))
    transfer = bool(user.get("transfer_enabled") and user.get("transfer_number"))
    return is_pro(user) and (card or transfer)


def _pay_url_for(conn, user, iid, base):
    """The invoice's public pay URL, ready to share. Creates the pay token when
    the owner has payments on so the frontend can open WhatsApp synchronously
    (no extra round-trip at tap time). '' when payments aren't set up."""
    if not _payments_ready(user):
        return ""
    row = conn.execute("SELECT pay_token FROM invoices WHERE id=?", (iid,)).fetchone()
    token = row["pay_token"] if row else None
    if not token:
        import secrets as _secrets
        token = _secrets.token_urlsafe(12)
        conn.execute("UPDATE invoices SET pay_token=? WHERE id=?", (token, iid))
    return f"{base}/pay/{token}"


@app.get("/api/invoices")
def list_invoices(request: Request, user=Depends(current_user)):
    sfi, spi = _shop_and(_active_shop(user), "i")
    base = str(request.base_url).rstrip("/")
    with db.get_conn() as conn:
        invs = conn.execute(
            "SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, s.name AS shop_name FROM invoices i "
            "LEFT JOIN customers c ON c.id=i.customer_id "
            "LEFT JOIN shops s ON s.id=i.shop_id "
            "WHERE i.user_id=?" + sfi + " ORDER BY i.date DESC, i.id DESC",
            [user["id"]] + spi,
        ).fetchall()
        result = []
        for inv in invs:
            d = dict(inv)
            paid = paid_for(conn, inv["id"])
            d["paid"] = paid
            d["balance"] = inv["total"] - paid
            d["status"] = status_for(inv["total"], paid)
            d["cash_paid"] = cash_paid_for(conn, inv["id"])
            if d["balance"] > 0.01:
                d["pay_url"] = _pay_url_for(conn, user, inv["id"], base)
            if user.get("is_attendant"):  # attendants never see cost/margin
                d.pop("cost_total", None)
            result.append(d)
        return result


@app.get("/api/invoices/{iid}")
def get_invoice(iid: int, request: Request, user=Depends(current_user)):
    base = str(request.base_url).rstrip("/")
    with db.get_conn() as conn:
        inv = _owned_invoice(conn, iid, user["id"])
        payload = _invoice_payload(conn, dict(inv))
        if payload["balance"] > 0.01:
            payload["pay_url"] = _pay_url_for(conn, user, iid, base)
        if user.get("is_attendant"):  # attendants never see cost/margin
            payload.pop("cost_total", None)
            for it in payload["items"]:
                it.pop("unit_cost", None)
        return payload


@app.post("/api/invoices")
def create_invoice(inv: InvoiceIn, user=Depends(current_user)):
    if not inv.items:
        raise HTTPException(400, "An invoice needs at least one item")
    uid = user["id"]
    with db.get_conn() as conn:
        # Idempotent replay: a sale queued offline carries a client_uid; if we've
        # already created it (e.g. the response was lost on a flaky link and the
        # client retried), return that invoice instead of creating a duplicate.
        if inv.client_uid:
            dup = conn.execute(
                "SELECT id, invoice_no, total FROM invoices WHERE user_id=? AND client_uid=?",
                (uid, inv.client_uid)).fetchone()
            if dup:
                return {"id": dup["id"], "invoice_no": dup["invoice_no"], "total": dup["total"]}
        if not is_pro(user) and _invoices_this_month(conn, uid) >= FREE_MAX_INVOICES_PER_MONTH:
            raise HTTPException(
                402, f"Free plan limit reached ({FREE_MAX_INVOICES_PER_MONTH} invoices this "
                     "month). Upgrade to Pro for unlimited invoices.")
        shop_id = _write_shop(conn, user)
        # Resolve customer (scoped to this shop): explicit id wins; else a typed
        # name reuses an existing customer (case-insensitive) or creates one.
        customer_id = inv.customer_id
        if customer_id:
            owns = conn.execute(
                "SELECT 1 FROM customers WHERE id=? AND user_id=?", (customer_id, uid)).fetchone()
            if not owns:
                customer_id = None
        if not customer_id and inv.customer_name and inv.customer_name.strip():
            name = inv.customer_name.strip()
            row = conn.execute(
                "SELECT id FROM customers WHERE user_id=? AND shop_id=? AND lower(name)=lower(?)",
                (uid, shop_id, name)).fetchone()
            if row:
                customer_id = row["id"]
            else:
                cur = conn.execute(
                    "INSERT INTO customers(user_id,shop_id,name,created_at) VALUES(?,?,?,?)",
                    (uid, shop_id, name, db.now_iso()))
                customer_id = cur.lastrowid

        # Resolve each line's cost. Attendants never receive unit_cost, so trust
        # the product's own cost from the DB (keeps profit correct AND hidden);
        # owners keep sending it as before.
        costs = []
        for it in inv.items:
            c = it.unit_cost
            if user.get("is_attendant") and it.product_id:
                prow = conn.execute(
                    "SELECT unit_cost FROM products WHERE id=? AND user_id=?",
                    (it.product_id, uid)).fetchone()
                c = (prow["unit_cost"] if prow else 0) or 0
            costs.append(c)
        total = sum(it.qty * it.unit_price for it in inv.items)
        cost_total = sum(it.qty * c for it, c in zip(inv.items, costs))
        no = next_invoice_no(conn, uid)
        cur = conn.execute(
            "INSERT INTO invoices(user_id,shop_id,invoice_no,customer_id,date,due_date,status,notes,"
            "total,cost_total,client_uid,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (uid, shop_id, no, customer_id, inv.date or today(), inv.due_date, "unpaid",
             inv.notes, total, cost_total, inv.client_uid, db.now_iso()),
        )
        iid = cur.lastrowid
        for it, c in zip(inv.items, costs):
            conn.execute(
                "INSERT INTO invoice_items(invoice_id,product_id,description,qty,"
                "unit_price,unit_cost) VALUES(?,?,?,?,?,?)",
                (iid, it.product_id, it.description, it.qty, it.unit_price, c),
            )
            # decrement stock if linked to one of the user's products
            if it.product_id:
                conn.execute(
                    "UPDATE products SET stock_qty = stock_qty - ? WHERE id=? AND user_id=?",
                    (it.qty, it.product_id, uid),
                )
        # Optional bundled payment (an offline sale paid on the spot): record it
        # in the same request so the sync queue never holds a payment that points
        # at a not-yet-created invoice id.
        if inv.payment and (inv.payment.amount or 0) > 0:
            conn.execute(
                "INSERT INTO payments(invoice_id,amount,date,method,note) VALUES(?,?,?,?,?)",
                (iid, inv.payment.amount, inv.payment.date or today(),
                 inv.payment.method, inv.payment.note))
            conn.execute("UPDATE invoices SET status=? WHERE id=?",
                         (status_for(total, paid_for(conn, iid)), iid))
        # Referral payoff: this account's FIRST sale earns their inviter a free
        # month — rewards real usage, not throwaway signups. Capped per inviter.
        if user.get("referred_by") and not user.get("ref_rewarded"):
            conn.execute("UPDATE users SET ref_rewarded=1 WHERE id=?", (uid,))
            n = conn.execute(
                "SELECT COUNT(*) FROM users WHERE referred_by=? AND ref_rewarded=1",
                (user["referred_by"],)).fetchone()[0]
            if n <= REFERRAL_CAP:
                _grant_days(conn, user["referred_by"], REFERRAL_DAYS)
        return {"id": iid, "invoice_no": no, "total": total}


def _restore_stock(conn, iid, uid):
    """Give back whatever stock a sale's items reserved — called before
    deleting an invoice, and before replacing its items on edit."""
    items = conn.execute(
        "SELECT product_id, qty FROM invoice_items WHERE invoice_id=?", (iid,)).fetchall()
    for it in items:
        if it["product_id"]:
            conn.execute(
                "UPDATE products SET stock_qty = stock_qty + ? WHERE id=? AND user_id=?",
                (it["qty"], it["product_id"], uid))


@app.put("/api/invoices/{iid}")
def update_invoice(iid: int, inv: InvoiceIn, user=Depends(current_user)):
    """Edit an existing sale's customer/items/date/notes. Stock is reconciled
    (old items' qty restored, new items' qty deducted) and the total/status
    are recomputed — revenue, profit, and every report read these tables
    live, so nothing else needs to change."""
    if not inv.items:
        raise HTTPException(400, "An invoice needs at least one item")
    uid = user["id"]
    with db.get_conn() as conn:
        old = _owned_invoice(conn, iid, uid)
        _restore_stock(conn, iid, uid)

        customer_id = inv.customer_id
        if customer_id:
            owns = conn.execute(
                "SELECT 1 FROM customers WHERE id=? AND user_id=?", (customer_id, uid)).fetchone()
            if not owns:
                customer_id = None
        if not customer_id and inv.customer_name and inv.customer_name.strip():
            name = inv.customer_name.strip()
            row = conn.execute(
                "SELECT id FROM customers WHERE user_id=? AND shop_id=? AND lower(name)=lower(?)",
                (uid, old["shop_id"], name)).fetchone()
            if row:
                customer_id = row["id"]
            else:
                cur = conn.execute(
                    "INSERT INTO customers(user_id,shop_id,name,created_at) VALUES(?,?,?,?)",
                    (uid, old["shop_id"], name, db.now_iso()))
                customer_id = cur.lastrowid

        costs = []
        for it in inv.items:
            c = it.unit_cost
            if user.get("is_attendant") and it.product_id:
                prow = conn.execute(
                    "SELECT unit_cost FROM products WHERE id=? AND user_id=?",
                    (it.product_id, uid)).fetchone()
                c = (prow["unit_cost"] if prow else 0) or 0
            costs.append(c)
        total = sum(it.qty * it.unit_price for it in inv.items)
        cost_total = sum(it.qty * c for it, c in zip(inv.items, costs))

        conn.execute(
            "UPDATE invoices SET customer_id=?, date=?, due_date=?, notes=?, total=?, cost_total=? "
            "WHERE id=?",
            (customer_id, inv.date or old["date"], inv.due_date, inv.notes, total, cost_total, iid))
        conn.execute("DELETE FROM invoice_items WHERE invoice_id=?", (iid,))
        for it, c in zip(inv.items, costs):
            conn.execute(
                "INSERT INTO invoice_items(invoice_id,product_id,description,qty,"
                "unit_price,unit_cost) VALUES(?,?,?,?,?,?)",
                (iid, it.product_id, it.description, it.qty, it.unit_price, c))
            if it.product_id:
                conn.execute(
                    "UPDATE products SET stock_qty = stock_qty - ? WHERE id=? AND user_id=?",
                    (it.qty, it.product_id, uid))
        conn.execute("UPDATE invoices SET status=? WHERE id=?",
                     (status_for(total, paid_for(conn, iid)), iid))
        return {"id": iid, "invoice_no": old["invoice_no"], "total": total}


@app.delete("/api/invoices/{iid}")
def delete_invoice(iid: int, user=Depends(current_user)):
    with db.get_conn() as conn:
        _owned_invoice(conn, iid, user["id"])
        _restore_stock(conn, iid, user["id"])
        conn.execute("DELETE FROM invoices WHERE id=?", (iid,))
    return {"ok": True}


@app.post("/api/invoices/{iid}/payments")
def add_payment(iid: int, p: PaymentIn, user=Depends(current_user)):
    with db.get_conn() as conn:
        inv = _owned_invoice(conn, iid, user["id"])
        conn.execute(
            "INSERT INTO payments(invoice_id,amount,date,method,note) VALUES(?,?,?,?,?)",
            (iid, p.amount, p.date or today(), p.method, p.note),
        )
        paid = paid_for(conn, iid)
        conn.execute("UPDATE invoices SET status=? WHERE id=?",
                     (status_for(inv["total"], paid), iid))
        return {"ok": True, "paid": paid, "balance": inv["total"] - paid}


def _pay_to(user):
    """Merchant's bank details for the 'Pay to' block on invoices (or None when
    they haven't set up bank transfer). Read from their transfer/payout account."""
    if user.get("transfer_enabled") and user.get("transfer_number"):
        return {"name": user.get("transfer_name") or "",
                "number": user.get("transfer_number") or "",
                "bank": user.get("transfer_bank") or ""}
    return None


@app.get("/api/invoices/{iid}/pdf")
def invoice_pdf(iid: int, download: int = 0, user=Depends(current_user)):
    with db.get_conn() as conn:
        inv = _owned_invoice(conn, iid, user["id"])
        payload = _invoice_payload(conn, dict(inv))
    settings = db.get_settings(user["id"])
    settings["pay_to"] = _pay_to(user)
    pdf_bytes = build_invoice_pdf(
        payload, payload["items"], payload["customer"], settings, payload["paid"])
    return RawResponse(
        content=pdf_bytes,
        media_type="application/pdf",
        headers=_disposition(f'{inv["invoice_no"]}.pdf', download),
    )


def _disposition(filename, download):
    # attachment => the Android WebView's DownloadListener saves the file instead
    # of rendering it inline (which strands the user, since the WebView has no
    # navigator.share to fall back to). inline keeps the WhatsApp preview behaviour.
    kind = "attachment" if download else "inline"
    return {"Content-Disposition": f'{kind}; filename="{filename}"'}


def _img_response(data, filename, fmt, download=False):
    return RawResponse(
        content=data,
        media_type="image/jpeg" if fmt == "jpg" else "image/png",
        headers=_disposition(filename, download),
    )


@app.get("/api/promo/image")
def promo_image(fmt: str = "png", download: int = 0, user=Depends(current_user)):
    """Ready-to-post promo flyer of the active shop's in-stock products and
    prices — the merchant's free ad for WhatsApp Status/groups."""
    if fmt not in ("png", "jpg"):
        raise HTTPException(400, "fmt must be png or jpg")
    sf, sp = _shop_and(_active_shop(user))
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT name, unit_price, stock_qty, low_stock_at, photo FROM products "
            "WHERE user_id=? AND stock_qty > 0" + sf + " ORDER BY name LIMIT 12",
            [user["id"]] + sp).fetchall()
    if not rows:
        raise HTTPException(400, "Add products with stock first — the flyer shows what's available")
    products = db.rows_to_list(rows)
    for p in products:  # resolve to a readable file path for the renderer
        path = os.path.join(PHOTOS_DIR, p["photo"]) if p.get("photo") else None
        p["photo_path"] = path if (path and os.path.exists(path)) else None
    data = imgdoc.build_promo_image(products, db.get_settings(user["id"]), fmt)
    return _img_response(data, f"promo.{fmt}", fmt, download)


@app.get("/api/invoices/{iid}/image")
def invoice_image(iid: int, fmt: str = "png", download: int = 0, user=Depends(current_user)):
    """Invoice as a shareable image — previews inline in WhatsApp chats."""
    if fmt not in ("png", "jpg"):
        raise HTTPException(400, "fmt must be png or jpg")
    with db.get_conn() as conn:
        inv = _owned_invoice(conn, iid, user["id"])
        payload = _invoice_payload(conn, dict(inv))
    settings = db.get_settings(user["id"])
    settings["pay_to"] = _pay_to(user)
    data = imgdoc.build_invoice_image(
        payload, payload["items"], payload["customer"], settings, payload["paid"], fmt)
    return _img_response(data, f"{inv['invoice_no']}.{fmt}", fmt, download)


@app.get("/api/invoices/{iid}/receipt")
def invoice_receipt(iid: int, fmt: str = "png", download: int = 0, user=Depends(current_user)):
    """Receipt image for the most recent payment, with a thank-you message."""
    if fmt not in ("png", "jpg"):
        raise HTTPException(400, "fmt must be png or jpg")
    with db.get_conn() as conn:
        inv = _owned_invoice(conn, iid, user["id"])
        payload = _invoice_payload(conn, dict(inv))
    if not payload["payments"]:
        raise HTTPException(400, "No payments recorded on this invoice yet")
    settings = db.get_settings(user["id"])
    latest = payload["payments"][-1]
    data = imgdoc.build_receipt_image(
        payload, latest, payload["customer"], settings,
        payload["paid"], payload["balance"], fmt)
    return _img_response(data, f"Receipt-{inv['invoice_no']}.{fmt}", fmt, download)


# -------------------- Online payments (invoice collection) ------------------
# A merchant links their bank once; SalesPal creates a Paystack subaccount so
# customer payments settle straight to that bank (SalesPal never holds funds).
# Generating pay links is Pro-gated; the platform takes no cut (0% subaccount).
def _pay_status(user):
    connected = bool(user.get("pay_enabled") and user.get("pay_subaccount"))
    acct = user.get("pay_account_number") or ""
    return {
        "connected": connected,
        "billing_enabled": billing.enabled(),
        "is_pro": is_pro(user),
        "bank_name": user.get("pay_bank_name") or "",
        "account_name": user.get("pay_account_name") or "",
        "account_masked": ("••••" + acct[-4:]) if len(acct) >= 4 else acct,
        # Direct bank transfer (instant): the account shown to customers.
        "transfer_enabled": bool(user.get("transfer_enabled")),
        "transfer_name": user.get("transfer_name") or "",
        "transfer_number": user.get("transfer_number") or "",
        "transfer_bank": user.get("transfer_bank") or "",
    }


@app.get("/api/pay/status")
def pay_status(user=Depends(current_user)):
    return _pay_status(user)


@app.get("/api/pay/banks")
def pay_banks(user=Depends(current_user)):
    if not billing.enabled():
        raise HTTPException(503, "Payments aren't set up yet")
    return {"banks": billing.list_banks()}


def _clean_acct(s):
    return "".join(ch for ch in (s or "") if ch.isdigit())


@app.post("/api/pay/resolve")
def pay_resolve(data: BankResolveIn, user=Depends(current_user)):
    if not billing.enabled():
        raise HTTPException(503, "Payments aren't set up yet")
    acct = _clean_acct(data.account_number)
    if len(acct) != 10:
        raise HTTPException(400, "Enter a valid 10-digit account number")
    res = billing.resolve_account(acct, data.bank_code)
    if not res.get("status"):
        raise HTTPException(400, res.get("message") or "Couldn't verify that account")
    return {"account_name": (res.get("data") or {}).get("account_name", "")}


@app.post("/api/pay/connect")
def pay_connect(data: PayConnectIn, user=Depends(current_user)):
    if not billing.enabled():
        raise HTTPException(503, "Payments aren't set up yet")
    if not is_pro(user):
        raise HTTPException(
            402, "Collecting payments online is a Pro feature. Upgrade to let "
                 "customers pay you by card, transfer or USSD.")
    acct = _clean_acct(data.account_number)
    if len(acct) != 10:
        raise HTTPException(400, "Enter a valid 10-digit account number")
    res = billing.resolve_account(acct, data.bank_code)
    if not res.get("status"):
        raise HTTPException(400, res.get("message") or "Couldn't verify that account")
    account_name = (res.get("data") or {}).get("account_name", "")
    settings = db.get_settings(user["id"])
    biz = settings.get("business_name") or user.get("business_name") or "SalesPal merchant"
    bank_name = next((b["name"] for b in billing.list_banks()
                      if b["code"] == data.bank_code), "")
    existing = user.get("pay_subaccount")
    if existing:
        r = billing.update_subaccount(existing, biz, data.bank_code, acct, 0)
        code = existing if r.get("status") else None
    else:
        r = billing.create_subaccount(biz, data.bank_code, acct, 0)
        code = (r.get("data") or {}).get("subaccount_code") if r.get("status") else None
    if not code:
        raise HTTPException(502, r.get("message") or "Couldn't set up payouts — please try again")
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE users SET pay_subaccount=?,pay_bank_code=?,pay_bank_name=?,"
            "pay_account_number=?,pay_account_name=?,pay_enabled=1 WHERE id=?",
            (code, data.bank_code, bank_name, acct, account_name, user["id"]))
        u = db.get_user(conn, user["id"])
    return _pay_status(dict(u))


@app.post("/api/pay/disconnect")
def pay_disconnect(user=Depends(current_user)):
    with db.get_conn() as conn:
        conn.execute("UPDATE users SET pay_enabled=0 WHERE id=?", (user["id"],))
        u = db.get_user(conn, user["id"])
    return _pay_status(dict(u))


@app.post("/api/pay/transfer")
def pay_set_transfer(data: TransferSetIn, user=Depends(current_user)):
    """Set the bank account customers transfer to directly (instant, no fee).
    Pro-gated, same as the rest of online payments."""
    if not is_pro(user):
        raise HTTPException(
            402, "Accepting payments is a Pro feature. Upgrade to add a "
                 "bank-transfer option to your invoices.")
    enabled = 1 if data.enabled else 0
    name = (data.account_name or "").strip()
    number = _clean_acct(data.account_number)
    bank = (data.bank or "").strip()
    if enabled and not (name and number and bank):
        raise HTTPException(400, "Enter the account name, number and bank")
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE users SET transfer_enabled=?,transfer_name=?,transfer_number=?,"
            "transfer_bank=? WHERE id=?",
            (enabled, name, number, bank, user["id"]))
        u = db.get_user(conn, user["id"])
    return _pay_status(dict(u))


@app.post("/api/invoices/{iid}/payment-link")
def invoice_payment_link(iid: int, request: Request, user=Depends(current_user)):
    """Create (or reuse) the public pay link for an invoice. Pro-gated.
    Works with card (Paystack) and/or instant bank transfer enabled."""
    if not is_pro(user):
        raise HTTPException(
            402, "Online payment links are a Pro feature. Upgrade to let "
                 "customers pay you by card, transfer or USSD.")
    card_ready = bool(user.get("pay_enabled") and user.get("pay_subaccount"))
    transfer_ready = bool(user.get("transfer_enabled") and user.get("transfer_number"))
    if not (card_ready or transfer_ready):
        raise HTTPException(400, "Turn on a payment option under Settings first (instant bank transfer or card).")
    import secrets as _secrets
    with db.get_conn() as conn:
        inv = _owned_invoice(conn, iid, user["id"])
        token = inv["pay_token"]
        if not token:
            token = _secrets.token_urlsafe(12)
            conn.execute("UPDATE invoices SET pay_token=? WHERE id=?", (token, iid))
    base = str(request.base_url).rstrip("/")
    return {"url": f"{base}/pay/{token}", "token": token}


# -- Public (no auth): the customer-facing pay page reads these by link token --
def _invoice_by_token(conn, token):
    return conn.execute("SELECT * FROM invoices WHERE pay_token=?", (token,)).fetchone()


@app.get("/api/pay/invoice/{token}")
def public_invoice(token: str):
    with db.get_conn() as conn:
        inv = _invoice_by_token(conn, token)
        if not inv:
            raise HTTPException(404, "Payment link not found")
        owner = db.get_user(conn, inv["user_id"])
        paid = paid_for(conn, inv["id"])
        cust = conn.execute("SELECT name FROM customers WHERE id=?",
                            (inv["customer_id"],)).fetchone() if inv["customer_id"] else None
    settings = db.get_settings(inv["user_id"])
    balance = (inv["total"] or 0) - paid
    card_enabled = bool(owner and owner["pay_enabled"] and owner["pay_subaccount"]
                        and billing.enabled())
    transfer_enabled = bool(owner and owner["transfer_enabled"]
                            and owner["transfer_number"])
    # has the customer already tapped "I've sent it" (awaiting merchant confirm)?
    with db.get_conn() as c2:
        pending = bool(c2.execute(
            "SELECT 1 FROM invoice_claims WHERE invoice_id=? AND status='pending'",
            (inv["id"],)).fetchone())
    out = {
        "business_name": settings.get("business_name") or "SalesPal merchant",
        "currency": settings.get("currency") or "₦",
        "invoice_no": inv["invoice_no"],
        "customer_name": cust["name"] if cust else "",
        "total": inv["total"] or 0,
        "amount_due": max(0, balance),
        "status": status_for(inv["total"] or 0, paid),
        "enabled": card_enabled or transfer_enabled,
        "card_enabled": card_enabled,
        "transfer_enabled": transfer_enabled,
        "transfer_pending": pending,
    }
    if transfer_enabled:
        out["transfer"] = {
            "name": owner["transfer_name"] or "",
            "number": owner["transfer_number"] or "",
            "bank": owner["transfer_bank"] or "",
        }
    return out


@app.post("/api/pay/invoice/{token}/init")
def public_invoice_init(token: str, request: Request):
    if not billing.enabled():
        raise HTTPException(503, "Payments aren't available")
    with db.get_conn() as conn:
        inv = _invoice_by_token(conn, token)
        if not inv:
            raise HTTPException(404, "Payment link not found")
        owner = db.get_user(conn, inv["user_id"])
        paid = paid_for(conn, inv["id"])
        cust = conn.execute("SELECT email FROM customers WHERE id=?",
                            (inv["customer_id"],)).fetchone() if inv["customer_id"] else None
    if not (owner and owner["pay_enabled"] and owner["pay_subaccount"]):
        raise HTTPException(400, "This business isn't accepting online payments right now")
    balance = round((inv["total"] or 0) - paid, 2)
    if balance <= 0:
        raise HTTPException(400, "This invoice is already fully paid")
    settings = db.get_settings(inv["user_id"])
    email = (cust["email"] if cust and cust["email"] else None) \
        or settings.get("email") or owner["email"]
    import secrets as _secrets
    reference = f"invpay_{inv['id']}_" + _secrets.token_hex(8)
    base = str(request.base_url).rstrip("/")
    callback_url = f"{base}/pay/{token}?done=1"
    try:
        res = billing.init_transaction(
            email, int(round(balance * 100)), reference, callback_url,
            {"purpose": "invoice", "invoice_id": inv["id"], "user_id": inv["user_id"]},
            subaccount=owner["pay_subaccount"])
    except Exception:
        raise HTTPException(502, "Couldn't reach the payment provider")
    if not res.get("status"):
        raise HTTPException(502, res.get("message") or "Couldn't start the payment")
    return {"authorization_url": res["data"]["authorization_url"]}


@app.get("/api/pay/verify")
def public_pay_verify(reference: str):
    """Called by the pay page on return from Paystack for an instant result;
    the webhook is the source of truth, this just applies it sooner."""
    if not billing.enabled():
        raise HTTPException(503, "Payments aren't available")
    v = billing.verify_transaction(reference)
    paid = False
    if v.get("status"):
        data = v.get("data")
        if ((data or {}).get("metadata") or {}).get("purpose") == "invoice":
            with db.get_conn() as conn:
                _record_invoice_payment(conn, data)
            paid = (data or {}).get("status") == "success"
    return {"paid": paid}


@app.post("/api/pay/invoice/{token}/claim")
def public_invoice_claim(token: str, data: ClaimIn):
    """Customer tapped 'I've sent the transfer' — log a PENDING claim for the
    merchant to confirm. Never marks the invoice paid on its own."""
    with db.get_conn() as conn:
        inv = _invoice_by_token(conn, token)
        if not inv:
            raise HTTPException(404, "Payment link not found")
        owner = db.get_user(conn, inv["user_id"])
        if not (owner and owner["transfer_enabled"] and owner["transfer_number"]):
            raise HTTPException(400, "Bank transfer isn't available for this invoice")
        paid = paid_for(conn, inv["id"])
        balance = round((inv["total"] or 0) - paid, 2)
        if balance <= 0:
            raise HTTPException(400, "This invoice is already fully paid")
        amount = data.amount if (data.amount and data.amount > 0) else balance
        # don't pile up duplicate pending claims for the same invoice
        if not conn.execute(
                "SELECT 1 FROM invoice_claims WHERE invoice_id=? AND status='pending'",
                (inv["id"],)).fetchone():
            conn.execute(
                "INSERT INTO invoice_claims(invoice_id,amount,note,status,created_at) "
                "VALUES(?,?,?,'pending',?)",
                (inv["id"], amount, (data.note or "")[:200], db.now_iso()))
    return {"ok": True}


def _pending_claims(conn, iid):
    return db.rows_to_list(conn.execute(
        "SELECT * FROM invoice_claims WHERE invoice_id=? AND status='pending' "
        "ORDER BY id", (iid,)).fetchall())


@app.get("/api/pay/claims/pending")
def list_pending_claims(user=Depends(current_user)):
    """Invoices with a customer-reported transfer awaiting the merchant's OK."""
    sf, sp = _shop_and(_active_shop(user))
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT c.id claim_id, c.amount, c.created_at, i.id invoice_id, "
            "i.invoice_no FROM invoice_claims c JOIN invoices i ON i.id=c.invoice_id "
            "WHERE c.status='pending' AND i.user_id=?" + sf + " ORDER BY c.id DESC",
            [user["id"]] + sp).fetchall()
    return db.rows_to_list(rows)


@app.post("/api/invoices/{iid}/claims/{cid}/confirm")
def confirm_claim(iid: int, cid: int, user=Depends(current_user)):
    """Merchant confirms a transfer arrived → record it as a real payment."""
    with db.get_conn() as conn:
        inv = _owned_invoice(conn, iid, user["id"])
        claim = conn.execute(
            "SELECT * FROM invoice_claims WHERE id=? AND invoice_id=? AND status='pending'",
            (cid, iid)).fetchone()
        if not claim:
            raise HTTPException(404, "No pending claim to confirm")
        already_paid = paid_for(conn, iid)
        due = round((inv["total"] or 0) - already_paid, 2)
        # Nothing due (e.g. paid by card after the claim) → never record another
        # payment; fall through to the "already fully paid" close-out below.
        amount = min(claim["amount"] or due, due) if due > 0 else 0
        if amount <= 0:
            conn.execute("UPDATE invoice_claims SET status='confirmed' WHERE id=?", (cid,))
            raise HTTPException(400, "This invoice is already fully paid")
        conn.execute(
            "INSERT INTO payments(invoice_id,amount,date,method,note) VALUES(?,?,?,?,?)",
            (iid, amount, today(), "Bank transfer", "Confirmed by you"))
        conn.execute("UPDATE invoice_claims SET status='confirmed' WHERE id=?", (cid,))
        paid = paid_for(conn, iid)
        conn.execute("UPDATE invoices SET status=? WHERE id=?",
                     (status_for(inv["total"], paid), iid))
    return {"ok": True, "paid": paid, "balance": (inv["total"] or 0) - paid}


@app.post("/api/invoices/{iid}/claims/{cid}/dismiss")
def dismiss_claim(iid: int, cid: int, user=Depends(current_user)):
    with db.get_conn() as conn:
        _owned_invoice(conn, iid, user["id"])  # ownership check
        conn.execute(
            "UPDATE invoice_claims SET status='dismissed' WHERE id=? AND invoice_id=?",
            (cid, iid))
    return {"ok": True}


# ----------------------------- Orders (storefront) --------------------------
def _order_items(conn, order_id):
    return db.rows_to_list(conn.execute(
        "SELECT product_id, description, qty, unit_price, unit_cost "
        "FROM order_items WHERE order_id=? ORDER BY id", (order_id,)).fetchall())


def _order_payload(conn, o):
    o = dict(o)
    o["items"] = _order_items(conn, o["id"])
    return o


def _order_link(request, token):
    return f"{str(request.base_url).rstrip('/')}/order/{token}"


@app.get("/api/orders/status")
def orders_status(request: Request, user=Depends(current_user)):
    """Storefront on/off + share link for the active shop, plus pending count."""
    shop = _active_shop(user)
    with db.get_conn() as conn:
        sf, sp = _shop_and(shop)
        pending = conn.execute(
            "SELECT COUNT(*) c FROM orders WHERE user_id=? AND status='pending'" + sf,
            [user["id"]] + sp).fetchone()["c"]
        row = conn.execute(
            "SELECT orders_enabled, order_token FROM shops WHERE id=? AND user_id=?",
            (shop, user["id"])).fetchone() if shop else None
        enabled = bool(row and row["orders_enabled"] and row["order_token"])
        token = row["order_token"] if (row and enabled) else None
    return {
        "shop_id": shop,
        "is_pro": is_pro(user),
        "enabled": enabled,
        "url": _order_link(request, token) if token else None,
        "pending": pending,
    }


@app.post("/api/orders/enable")
def enable_orders(request: Request, user=Depends(current_user)):
    if not is_pro(user):
        raise HTTPException(402, "Taking orders online is a Pro feature. Upgrade to share your shop link.")
    shop = _active_shop(user)
    if not shop:
        raise HTTPException(400, "Open a specific shop to share its order link")
    with db.get_conn() as conn:
        row = db.get_shop(conn, shop, user["id"])
        if not row:
            raise HTTPException(404, "Shop not found")
        token = conn.execute(
            "SELECT order_token FROM shops WHERE id=?", (shop,)).fetchone()["order_token"]
        if not token:
            import secrets as _secrets
            token = _secrets.token_urlsafe(9)
        conn.execute("UPDATE shops SET orders_enabled=1, order_token=? WHERE id=? AND user_id=?",
                     (token, shop, user["id"]))
    return {"enabled": True, "url": _order_link(request, token)}


@app.post("/api/orders/disable")
def disable_orders(user=Depends(current_user)):
    shop = _active_shop(user)
    if shop:
        with db.get_conn() as conn:
            conn.execute("UPDATE shops SET orders_enabled=0 WHERE id=? AND user_id=?",
                         (shop, user["id"]))
    return {"enabled": False}


@app.get("/api/orders")
def list_orders(user=Depends(current_user)):
    """Orders for the active shop (pending first, then newest)."""
    sf, sp = _shop_and(_active_shop(user))
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM orders WHERE user_id=?" + sf +
            " ORDER BY (status='pending') DESC, id DESC LIMIT 100",
            [user["id"]] + sp).fetchall()
        return [_order_payload(conn, r) for r in rows]


@app.get("/api/orders/pending")
def pending_orders(user=Depends(current_user)):
    """Just the pending orders — drives the home 'new orders' banner."""
    sf, sp = _shop_and(_active_shop(user))
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM orders WHERE user_id=? AND status='pending'" + sf +
            " ORDER BY id DESC", [user["id"]] + sp).fetchall()
        return [_order_payload(conn, r) for r in rows]


@app.post("/api/orders/{oid}/fulfill")
def fulfill_order(oid: int, user=Depends(current_user)):
    """Turn a pending order into a real invoice (+ reduce stock), mark fulfilled."""
    uid = user["id"]
    with db.get_conn() as conn:
        o = conn.execute(
            "SELECT * FROM orders WHERE id=? AND user_id=? AND status='pending'",
            (oid, uid)).fetchone()
        if not o:
            raise HTTPException(404, "No pending order to fulfil")
        items = _order_items(conn, oid)
        if not items:
            raise HTTPException(400, "This order has no items")
        shop_id = o["shop_id"]
        # Resolve/create the customer on this shop from the name they gave.
        customer_id = None
        name = (o["customer_name"] or "").strip()
        if name:
            row = conn.execute(
                "SELECT id FROM customers WHERE user_id=? AND shop_id=? AND lower(name)=lower(?)",
                (uid, shop_id, name)).fetchone()
            if row:
                customer_id = row["id"]
                if o["customer_phone"]:
                    conn.execute("UPDATE customers SET phone=COALESCE(phone,?) WHERE id=?",
                                 (o["customer_phone"], customer_id))
            else:
                customer_id = conn.execute(
                    "INSERT INTO customers(user_id,shop_id,name,phone,created_at) VALUES(?,?,?,?,?)",
                    (uid, shop_id, name, o["customer_phone"], db.now_iso())).lastrowid
        total = sum(it["qty"] * it["unit_price"] for it in items)
        cost_total = sum(it["qty"] * it["unit_cost"] for it in items)
        no = next_invoice_no(conn, uid)
        note = "From online order" + (f" · {o['note']}" if o["note"] else "")
        iid = conn.execute(
            "INSERT INTO invoices(user_id,shop_id,invoice_no,customer_id,date,due_date,status,notes,"
            "total,cost_total,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (uid, shop_id, no, customer_id, today(), None, "unpaid", note,
             total, cost_total, db.now_iso())).lastrowid
        for it in items:
            conn.execute(
                "INSERT INTO invoice_items(invoice_id,product_id,description,qty,unit_price,unit_cost) "
                "VALUES(?,?,?,?,?,?)",
                (iid, it["product_id"], it["description"], it["qty"], it["unit_price"], it["unit_cost"]))
            if it["product_id"]:
                conn.execute(
                    "UPDATE products SET stock_qty = stock_qty - ? WHERE id=? AND user_id=?",
                    (it["qty"], it["product_id"], uid))
        conn.execute("UPDATE orders SET status='fulfilled', invoice_id=? WHERE id=?", (iid, oid))
    return {"ok": True, "invoice_id": iid, "invoice_no": no, "total": total}


@app.post("/api/orders/{oid}/decline")
def decline_order(oid: int, user=Depends(current_user)):
    with db.get_conn() as conn:
        r = conn.execute(
            "UPDATE orders SET status='declined' WHERE id=? AND user_id=? AND status='pending'",
            (oid, user["id"]))
        if not r.rowcount:
            raise HTTPException(404, "No pending order to decline")
    return {"ok": True}


# -- Web-push (new-order alerts): the browser subscribes, orders trigger sends --
@app.get("/api/push/key")
def push_key(user=Depends(current_user)):
    return {"key": push.public_key()}


@app.post("/api/push/subscribe")
def push_subscribe(sub: dict = Body(...), user=Depends(current_user)):
    endpoint = (sub or {}).get("endpoint")
    if not endpoint or not isinstance((sub or {}).get("keys"), dict):
        raise HTTPException(400, "Invalid subscription")
    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO push_subs(user_id,endpoint,sub,created_at) VALUES(?,?,?,?) "
            "ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, sub=excluded.sub",
            (user["id"], endpoint, json.dumps(sub), db.now_iso()))
    return {"ok": True}


@app.post("/api/push/test")
def push_test(user=Depends(current_user)):
    """Send a test alert to your own devices — verifies the whole push path."""
    with db.get_conn() as conn:
        n = conn.execute("SELECT COUNT(*) c FROM push_subs WHERE user_id=?",
                         (user["id"],)).fetchone()["c"]
    if not n:
        raise HTTPException(400, "This account has no subscribed devices yet — tap Allow on the notification prompt first")
    push.notify(user["id"], "🔔 Test alert", "Order alerts are working!")
    return {"ok": True, "devices": n}


# -- Public (no auth): the customer-facing storefront reads/writes by shop token --
def _shop_by_order_token(conn, token):
    return conn.execute(
        "SELECT * FROM shops WHERE order_token=? AND orders_enabled=1", (token,)).fetchone()


@app.get("/api/shop/{token}")
def public_shop(token: str):
    """In-stock products a customer can order, for a shop's storefront link."""
    with db.get_conn() as conn:
        shop = _shop_by_order_token(conn, token)
        if not shop:
            raise HTTPException(404, "Shop not found")
        settings = db.get_settings(shop["user_id"])
        products = conn.execute(
            "SELECT id, name, unit_price, stock_qty FROM products "
            "WHERE user_id=? AND shop_id=? AND stock_qty > 0 ORDER BY name",
            (shop["user_id"], shop["id"])).fetchall()
    return {
        "business_name": shop["name"] or settings.get("business_name") or "Our shop",
        "currency": settings.get("currency") or "₦",
        "products": [{"id": p["id"], "name": p["name"],
                      "price": p["unit_price"] or 0, "stock": p["stock_qty"] or 0}
                     for p in products],
    }


@app.post("/api/shop/{token}/order")
def place_order(token: str, data: PlaceOrderIn):
    with db.get_conn() as conn:
        shop = _shop_by_order_token(conn, token)
        if not shop:
            raise HTTPException(404, "Shop not found")
        name = (data.customer_name or "").strip()
        if not name:
            raise HTTPException(400, "Please enter your name")
        rows = []
        for line in data.items:
            if line.qty <= 0:
                continue
            p = conn.execute(
                "SELECT id, name, unit_price, unit_cost, stock_qty FROM products "
                "WHERE id=? AND user_id=? AND shop_id=?",
                (line.product_id, shop["user_id"], shop["id"])).fetchone()
            if not p:
                continue
            qty = min(line.qty, p["stock_qty"] or 0)  # never accept more than in stock
            if qty <= 0:
                continue
            rows.append((p["id"], p["name"], qty, p["unit_price"] or 0, p["unit_cost"] or 0))
        if not rows:
            raise HTTPException(400, "None of those items are available right now")
        total = sum(q * up for (_, _, q, up, _) in rows)
        oid = conn.execute(
            "INSERT INTO orders(user_id,shop_id,customer_name,customer_phone,note,status,total,created_at) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (shop["user_id"], shop["id"], name, (data.customer_phone or "").strip() or None,
             (data.note or "").strip() or None, "pending", total, db.now_iso())).lastrowid
        for (pid, desc, qty, up, uc) in rows:
            conn.execute(
                "INSERT INTO order_items(order_id,product_id,description,qty,unit_price,unit_cost) "
                "VALUES(?,?,?,?,?,?)", (oid, pid, desc, qty, up, uc))
        cur_sym = db.get_settings(shop["user_id"]).get("currency") or "₦"
    # after commit: alert the merchant's devices (fire-and-forget, never blocks
    # or fails the customer's request)
    push.notify(shop["user_id"], f"🛒 New order — {shop['name']}",
                f"{name} · {len(rows)} item{'s' if len(rows) > 1 else ''} · {cur_sym}{total:,.2f}")
    return {"ok": True, "total": total, "business_name": shop["name"] or "the shop"}


# ----------------------------- Expenses -------------------------------------
@app.get("/api/expenses")
def list_expenses(user=Depends(current_user)):
    sf, sp = _shop_and(_active_shop(user))
    with db.get_conn() as conn:
        return db.rows_to_list(conn.execute(
            "SELECT * FROM expenses WHERE user_id=?" + sf + " ORDER BY date DESC, id DESC",
            [user["id"]] + sp).fetchall())


@app.post("/api/expenses")
def create_expense(e: ExpenseIn, user=Depends(current_user)):
    with db.get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO expenses(user_id,shop_id,category,amount,date,description,created_at) VALUES(?,?,?,?,?,?,?)",
            (user["id"], _write_shop(conn, user), e.category, e.amount, e.date or today(),
             e.description, db.now_iso()),
        )
        return {"id": cur.lastrowid}


@app.delete("/api/expenses/{eid}")
def delete_expense(eid: int, user=Depends(current_user)):
    with db.get_conn() as conn:
        conn.execute("DELETE FROM expenses WHERE id=? AND user_id=?", (eid, user["id"]))
    return {"ok": True}


# ----------------------------- Shops ----------------------------------------
def _active_shop(user):
    """Currently-active shop id; 0 (or unset) means the 'All shops' overview."""
    return user.get("active_shop_id") or 0


def _shop_and(shop_id, alias=""):
    """SQL fragment + params to scope a query to one shop. Empty for All shops."""
    if shop_id:
        col = (alias + "." if alias else "") + "shop_id"
        return f" AND {col}=?", [shop_id]
    return "", []


def _write_shop(conn, user):
    """A concrete shop for new data. In All-shops mode, fall back to the first shop."""
    return _active_shop(user) or db.default_shop_id(conn, user["id"])


@app.get("/api/shops")
def get_shops(user=Depends(current_user)):
    with db.get_conn() as conn:
        shops = db.list_shops(conn, user["id"])
    return {
        "shops": shops,
        "active_shop_id": _active_shop(user),
        # Free accounts are capped at their one default shop; Pro adds more.
        "can_add": is_pro(user) or len(shops) < 1,
    }


@app.post("/api/shops")
def add_shop(data: ShopIn, user=Depends(current_user)):
    with db.get_conn() as conn:
        if not is_pro(user) and db.shop_count(conn, user["id"]) >= 1:
            raise HTTPException(
                402, "Running multiple shops is a Pro feature. Upgrade to add more shops.")
        name = (data.name or "").strip() or "New Shop"
        sid = db.create_shop(conn, user["id"], name)
        db.set_active_shop(conn, user["id"], sid)  # jump straight into the new shop
    return {"id": sid, "name": name}


@app.put("/api/shops/{sid}")
def rename_shop(sid: int, data: ShopIn, user=Depends(current_user)):
    with db.get_conn() as conn:
        if not db.get_shop(conn, sid, user["id"]):
            raise HTTPException(404, "Shop not found")
        db.rename_shop(conn, sid, user["id"], data.name)
    return {"ok": True}


@app.post("/api/shops/active")
def switch_shop(data: ActiveShopIn, user=Depends(current_user)):
    with db.get_conn() as conn:
        if not db.set_active_shop(conn, user["id"], data.shop_id or 0):
            raise HTTPException(404, "Shop not found")
    return {"ok": True, "active_shop_id": data.shop_id or 0}


# ----------------------------- Metrics / Reports ----------------------------
def _metrics(conn, start: str, end: str, user_id, shop_id=0):
    """Metrics for one user's invoices/expenses/payments in [start, end].
    When shop_id is set, only that shop counts; 0 aggregates all the user's shops."""
    sf, sp = _shop_and(shop_id)
    sfi, spi = _shop_and(shop_id, "i")
    invs = conn.execute(
        "SELECT * FROM invoices WHERE user_id=? AND date >= ? AND date <= ?" + sf,
        [user_id, start, end] + sp).fetchall()
    revenue = sum(i["total"] for i in invs)
    cogs = sum(i["cost_total"] for i in invs)
    num_sales = len(invs)

    exp_rows = conn.execute(
        "SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE user_id=? AND date >= ? AND date <= ?" + sf,
        [user_id, start, end] + sp).fetchone()
    expenses = exp_rows["s"]

    pay_rows = conn.execute(
        "SELECT COALESCE(SUM(p.amount),0) s FROM payments p JOIN invoices i ON i.id=p.invoice_id "
        "WHERE i.user_id=? AND p.date >= ? AND p.date <= ?" + sfi,
        [user_id, start, end] + spi).fetchone()
    collected = pay_rows["s"]

    gross_profit = revenue - cogs
    net_profit = gross_profit - expenses
    return {
        "start": start, "end": end,
        "revenue": round(revenue, 2),
        "cogs": round(cogs, 2),
        "gross_profit": round(gross_profit, 2),
        "expenses": round(expenses, 2),
        "net_profit": round(net_profit, 2),
        "collected": round(collected, 2),
        "num_sales": num_sales,
        "avg_sale": round(revenue / num_sales, 2) if num_sales else 0,
        "margin_pct": round(net_profit / revenue * 100, 1) if revenue else 0,
    }


def _low_stock(conn, user_id, shop_id=0):
    sf, sp = _shop_and(shop_id)
    rows = conn.execute(
        "SELECT id, name, stock_qty, low_stock_at FROM products "
        "WHERE user_id=? AND low_stock_at > 0 AND stock_qty <= low_stock_at" + sf +
        " ORDER BY stock_qty ASC",
        [user_id] + sp,
    ).fetchall()
    # include each product's suppliers so the low-stock banner can offer a
    # one-tap "call supplier to reorder" action.
    return _attach_suppliers(conn, db.rows_to_list(rows))


def _outstanding(conn, user_id, shop_id=0):
    sf, sp = _shop_and(shop_id)
    invs = conn.execute(
        "SELECT * FROM invoices WHERE user_id=?" + sf, [user_id] + sp).fetchall()
    total_out = 0.0
    count = 0
    for i in invs:
        paid = paid_for(conn, i["id"])
        bal = i["total"] - paid
        if bal > 0.01:
            total_out += bal
            count += 1
    return {"outstanding": round(total_out, 2), "unpaid_invoices": count}


def _top_products(conn, start, end, user_id, shop_id=0, limit=5):
    sfi, spi = _shop_and(shop_id, "i")
    rows = conn.execute(
        "SELECT ii.description, SUM(ii.qty) qty, "
        "SUM(ii.qty*ii.unit_price) revenue, "
        "SUM(ii.qty*(ii.unit_price-ii.unit_cost)) profit "
        "FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id "
        "WHERE i.user_id=? AND i.date >= ? AND i.date <= ?" + sfi +
        " GROUP BY ii.description ORDER BY revenue DESC LIMIT ?",
        [user_id, start, end] + spi + [limit],
    ).fetchall()
    return db.rows_to_list(rows)


def _dashboard_data(conn, user_id, period, currency, shop_id=0):
    end = today()
    if period == "week":
        start = (date.today() - timedelta(days=6)).isoformat()
    elif period == "year":
        start = date(date.today().year, 1, 1).isoformat()
    elif period == "all":
        start = "0000-01-01"
    else:  # month
        start = (date.today() - timedelta(days=29)).isoformat()

    m = _metrics(conn, start, end, user_id, shop_id)
    m.update(_outstanding(conn, user_id, shop_id))
    m["low_stock"] = _low_stock(conn, user_id, shop_id)
    m["top_products"] = _top_products(conn, start, end, user_id, shop_id)
    days = (date.today() - date.fromisoformat(start)).days if start != "0000-01-01" else 30
    days = max(1, min(days, 30))
    trend = []
    for d in range(days, -1, -1):
        day = (date.today() - timedelta(days=d)).isoformat()
        dm = _metrics(conn, day, day, user_id, shop_id)
        trend.append({"date": day, "revenue": dm["revenue"], "profit": dm["net_profit"]})
    m["trend"] = trend
    m["currency"] = currency
    return m


def _shop_goal(conn, user_id, shop_id) -> float:
    """Monthly profit goal for a shop. shop_id 0 (All-shops) → the combined
    target summed across the user's shops."""
    if shop_id:
        row = conn.execute(
            "SELECT profit_goal FROM shops WHERE id=? AND user_id=?",
            (shop_id, user_id)).fetchone()
        return max(0.0, float(row["profit_goal"])) if row and row["profit_goal"] else 0.0
    row = conn.execute(
        "SELECT COALESCE(SUM(profit_goal),0) s FROM shops WHERE user_id=?",
        (user_id,)).fetchone()
    return max(0.0, float(row["s"] or 0))


@app.get("/api/dashboard")
def dashboard(period: str = "month", user=Depends(current_user)):
    settings = db.get_settings(user["id"])
    with db.get_conn() as conn:
        shop = _active_shop(user)
        data = _dashboard_data(conn, user["id"], period, settings["currency"], shop)
        # Monthly profit goal (per shop; combined on the All-shops overview).
        # Progress is always this *calendar* month's net profit (resets on the
        # 1st), independent of the period tab selected.
        goal = _shop_goal(conn, user["id"], shop)
        if goal > 0:
            month_start = date.today().replace(day=1).isoformat()
            mp = _metrics(conn, month_start, today(), user["id"], shop)["net_profit"]
            data["goal"] = {"target": goal, "month_profit": mp, "combined": not shop}
        return data


class GoalIn(BaseModel):
    amount: float = 0


@app.put("/api/goal")
def set_goal(data: GoalIn, user=Depends(current_user)):
    """Set the ACTIVE shop's monthly profit goal (each shop has its own)."""
    shop = _active_shop(user)
    if not shop:
        raise HTTPException(400, "Switch into a specific shop to set its goal")
    amt = max(0.0, data.amount)
    with db.get_conn() as conn:
        if not db.get_shop(conn, shop, user["id"]):
            raise HTTPException(404, "Shop not found")
        conn.execute("UPDATE shops SET profit_goal=? WHERE id=? AND user_id=?",
                     (amt, shop, user["id"]))
    return {"ok": True, "profit_goal": amt}


@app.get("/api/insights/advice")
def insights_advice(period: str = "month", user=Depends(current_user)):
    if not is_pro(user):
        raise HTTPException(402, "Upgrade to Pro for AI insights")
    settings = db.get_settings(user["id"])
    with db.get_conn() as conn:
        data = _dashboard_data(conn, user["id"], period, settings["currency"], _active_shop(user))
    payload = {k: data[k] for k in (
        "revenue", "cogs", "gross_profit", "expenses", "net_profit", "collected",
        "outstanding", "num_sales", "avg_sale", "margin_pct", "top_products")}
    payload["currency"] = settings["currency"]
    payload["period"] = period
    return ai.advice(payload)


@app.get("/api/insights/goal-tips")
def insights_goal_tips(refresh: bool = False, user=Depends(current_user)):
    """AI coaching for closing the gap to this month's profit goal. The advice is
    saved (per shop) so re-opening is instant and free; ?refresh=1 regenerates."""
    if not is_pro(user):
        raise HTTPException(402, "Upgrade to Pro for AI tips on hitting your goal")
    shop = _active_shop(user)
    with db.get_conn() as conn:
        if not refresh:
            row = conn.execute(
                "SELECT content, created_at FROM reports "
                "WHERE user_id=? AND type='goal_tips' AND COALESCE(shop_id,0)=? "
                "ORDER BY id DESC LIMIT 1", (user["id"], shop or 0)).fetchone()
            if row:
                return {"ok": True, "text": row["content"], "saved_at": row["created_at"]}
        settings = db.get_settings(user["id"])
        goal = _shop_goal(conn, user["id"], shop)
        month_start = date.today().replace(day=1).isoformat()
        m = _metrics(conn, month_start, today(), user["id"], shop)
        m["top_products"] = _top_products(conn, month_start, today(), user["id"], shop)
        m.update(_outstanding(conn, user["id"], shop))
        # days left this month so the advice can judge the pace realistically
        t = date.today()
        next_month = date(t.year + (t.month == 12), t.month % 12 + 1, 1)
        result = ai.goal_tips({
            "currency": settings["currency"],
            "monthly_profit_goal": goal,
            "profit_so_far_this_month": m["net_profit"],
            "days_left_in_month": (next_month - t).days,
            "this_month": m,
        })
        if result.get("ok"):
            conn.execute(
                "DELETE FROM reports WHERE user_id=? AND type='goal_tips' AND COALESCE(shop_id,0)=?",
                (user["id"], shop or 0))
            saved_at = db.now_iso()
            conn.execute(
                "INSERT INTO reports(user_id,shop_id,type,period_key,title,content,metrics,created_at) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (user["id"], shop or 0, "goal_tips", t.strftime("%Y-%m"),
                 "Goal tips", result["text"], "", saved_at))
            result["saved_at"] = saved_at
    return result


def _iso_week_key(d=None):
    d = d or date.today()
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def _build_weekly_payload(conn, user_id, shop_id=0):
    end = today()
    this_start = (date.today() - timedelta(days=6)).isoformat()
    last_end = (date.today() - timedelta(days=7)).isoformat()
    last_start = (date.today() - timedelta(days=13)).isoformat()
    settings = db.get_settings(user_id)
    this_week = _metrics(conn, this_start, end, user_id, shop_id)
    last_week = _metrics(conn, last_start, last_end, user_id, shop_id)
    this_week["top_products"] = _top_products(conn, this_start, end, user_id, shop_id)
    out = _outstanding(conn, user_id, shop_id)
    return {
        "currency": settings["currency"],
        "this_week": this_week,
        "last_week": last_week,
        "outstanding": out,
    }


def _generate_and_store_weekly(conn, user_id, period_key, shop_id=0):
    """Generate the weekly report and save it (replacing any for the same week)."""
    payload = _build_weekly_payload(conn, user_id, shop_id)
    result = ai.weekly_report(payload)
    if result.get("ok"):
        conn.execute(
            "DELETE FROM reports WHERE user_id=? AND type='weekly' AND period_key=? "
            "AND COALESCE(shop_id,0)=?",
            (user_id, period_key, shop_id or 0))
        conn.execute(
            "INSERT INTO reports(user_id,shop_id,type,period_key,title,content,metrics,created_at) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (user_id, shop_id or 0, "weekly", period_key,
             f"Week of {payload['this_week']['start']}",
             result["text"], json.dumps(payload), db.now_iso()),
        )
    return payload, result


@app.get("/api/insights/weekly")
def insights_weekly(user=Depends(current_user)):
    if not is_pro(user):
        raise HTTPException(402, "Upgrade to Pro for AI insights")
    with db.get_conn() as conn:
        payload, result = _generate_and_store_weekly(
            conn, user["id"], _iso_week_key(), _active_shop(user))
    result["metrics"] = payload
    return result


@app.get("/api/reports")
def list_reports(user=Depends(current_user)):
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT id,type,period_key,title,content,created_at FROM reports "
            "WHERE user_id=? ORDER BY id DESC LIMIT 12", (user["id"],)).fetchall()
    return db.rows_to_list(rows)


def _run_weekly_job(user_id, period_key):
    with db.get_conn() as conn:
        _generate_and_store_weekly(conn, user_id, period_key)


async def _weekly_scheduler():
    """Once a week (Sunday), auto-generate a weekly report for each user that
    has any sales activity (so idle accounts don't burn AI credits)."""
    while True:
        try:
            if date.today().weekday() == 6 and ai.available():  # 6 = Sunday
                key = _iso_week_key()
                with db.get_conn() as conn:
                    users = db.all_users(conn)
                for u in users:
                    if not is_pro(dict(u)):  # don't auto-spend AI credits on free accounts
                        continue
                    uid = u["id"]
                    with db.get_conn() as conn:
                        active = conn.execute(
                            "SELECT 1 FROM invoices WHERE user_id=? LIMIT 1", (uid,)).fetchone()
                        exists = conn.execute(
                            "SELECT 1 FROM reports WHERE user_id=? AND type='weekly' AND period_key=?",
                            (uid, key)).fetchone()
                    if active and not exists:
                        await asyncio.to_thread(_run_weekly_job, uid, key)
        except Exception:
            pass
        await asyncio.sleep(3600)  # check hourly


def _overdue_summary(conn, user_id):
    """(count, total_balance) of this user's overdue invoices — due in the past
    with money still owed. Balance from payments, not the stored status (which
    can be stale)."""
    rows = conn.execute(
        "SELECT i.total AS total, "
        "COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id=i.id),0) AS paid "
        "FROM invoices i WHERE i.user_id=? AND i.due_date IS NOT NULL AND i.due_date < ?",
        (user_id, today())).fetchall()
    owed = [r["total"] - r["paid"] for r in rows]
    owed = [b for b in owed if b > 0.01]
    return len(owed), sum(owed)


def _reminder_ping(user_id):
    """Once/day, push the owner a nudge if invoices are overdue. Reuses the
    global settings KV for a per-user 'last pinged on' date so it fires once a
    day, not once an hour."""
    key = f"overdue_ping:{user_id}"
    with db.get_conn() as conn:
        last = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        if last and last["value"] == today():
            return
        n, owed = _overdue_summary(conn, user_id)
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, today()))
    if not n:
        return
    cur = db.get_settings(user_id).get("currency", "₦")
    push.notify(
        user_id,
        f"💰 {n} overdue invoice{'s' if n != 1 else ''}",
        f"{cur}{owed:,.0f} still owed — tap to send WhatsApp reminders.",
        url="/app/#sales/overdue")


async def _reminder_scheduler():
    """Every hour, once past 09:00 local, nudge each Pro user who has overdue
    invoices (deduped to one push per day inside _reminder_ping)."""
    while True:
        try:
            if datetime.now().hour >= 9:
                with db.get_conn() as conn:
                    users = db.all_users(conn)
                for u in users:
                    if is_pro(dict(u)):
                        await asyncio.to_thread(_reminder_ping, u["id"])
        except Exception:
            pass
        await asyncio.sleep(3600)


@app.on_event("startup")
async def _start_scheduler():
    asyncio.create_task(_weekly_scheduler())
    asyncio.create_task(_reminder_scheduler())


@app.get("/api/health")
def health():
    return {"ok": True, "ai_enabled": ai.available()}


# ----------------------------- Static frontend ------------------------------
# The dashboard PWA lives under /app; the root serves the crawlable marketing
# page (plain HTML so Google indexes it — no JS needed to render content).
LANDING_DIR = os.path.join(os.path.dirname(__file__), "landing")
PAYPAGE_DIR = os.path.join(os.path.dirname(__file__), "paypage")


DOWNLOADS_DIR = os.path.join(os.path.dirname(__file__), "downloads")


@app.get("/.well-known/assetlinks.json", include_in_schema=False)
def assetlinks():
    """Digital Asset Links for the Android app (TWA): proves this domain owns the
    app so Chrome drops the address bar and it looks fully native. Set
    ANDROID_CERT_SHA256 to the signing key's SHA-256 fingerprint (comma-separate
    to allow more than one, e.g. your upload key + Play's app-signing key)."""
    fps = [f.strip() for f in os.environ.get("ANDROID_CERT_SHA256", "").split(",") if f.strip()]
    if not fps:
        raise HTTPException(404, "Android app link not configured yet")
    return JSONResponse([{
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": os.environ.get("ANDROID_PACKAGE", "online.salespal.twa"),
            "sha256_cert_fingerprints": fps,
        },
    }])


@app.get("/download/android", include_in_schema=False)
def download_android():
    """Serve the signed APK for direct install (drop it at downloads/salespal.apk
    after building). Until it's there, show a friendly note instead of a 404."""
    apk = os.path.join(DOWNLOADS_DIR, "salespal.apk")
    if os.path.exists(apk):
        return FileResponse(apk, media_type="application/vnd.android.package-archive",
                            filename="SalesPal.apk")
    return RawResponse(
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        "<div style='font-family:system-ui;max-width:32rem;margin:12vh auto;padding:0 24px;text-align:center'>"
        "<h1>SalesPal for Android</h1>"
        "<p>The installable app is coming shortly. For now, open "
        "<a href='/app/'>salespal.online</a> and tap your browser menu → "
        "<b>Add to Home screen</b> — it installs, works offline, and syncs when you're back online.</p>"
        "<p><a href='/app/'>Open SalesPal →</a></p></div>",
        media_type="text/html")


@app.get("/pay/{token}", include_in_schema=False)
def pay_page(token: str):
    """Public customer-facing checkout page for an invoice pay link."""
    return FileResponse(os.path.join(PAYPAGE_DIR, "pay.html"))


@app.get("/order/{token}", include_in_schema=False)
def order_page(token: str):
    """Public storefront: customers order from a shop's in-stock products."""
    return FileResponse(os.path.join(PAYPAGE_DIR, "order.html"))


@app.get("/sw.js", include_in_schema=False)
def legacy_root_sw():
    """Self-destructing service worker for installs that registered /sw.js
    before the dashboard moved to /app: unregisters the old root-scope worker
    and reloads its windows so they pick up /app/sw.js."""
    js = (
        "self.addEventListener('install',()=>self.skipWaiting());"
        "self.addEventListener('activate',e=>{e.waitUntil("
        "self.registration.unregister()"
        ".then(()=>self.clients.matchAll({type:'window'}))"
        ".then(cs=>cs.forEach(c=>c.navigate(c.url))))});"
    )
    return RawResponse(js, media_type="application/javascript")


@app.get("/", include_in_schema=False)
def root(request: Request):
    """Logged-in users go straight to the dashboard; visitors (and crawlers,
    which carry no session cookie) get the marketing page."""
    token = request.cookies.get(auth.COOKIE_NAME)
    if token:
        with db.get_conn() as conn:
            if db.user_for_session(conn, token):
                return RedirectResponse("/app/", status_code=302)
    return FileResponse(os.path.join(LANDING_DIR, "index.html"))


app.mount("/app", StaticFiles(directory=STATIC_DIR, html=True), name="app")
# Icons are shared: the app manifest and the landing favicon both use /icons/*.
app.mount("/icons", StaticFiles(directory=os.path.join(STATIC_DIR, "icons")), name="icons")
app.mount("/", StaticFiles(directory=LANDING_DIR, html=True), name="landing")
