"""Runnable check for voice-note orders: a customer's spoken order becomes a
pending order in the same inbox the storefront feeds, and fulfilling it produces
a real invoice + stock move. Transcribe/parse are stubbed — no network.
Run: python test_voice_order.py"""
import os, tempfile
os.environ["SALESPAL_DB"] = tempfile.mkstemp(suffix=".db")[1]

import db; db.init_db()
import ai, main, auth
from fastapi.testclient import TestClient

with db.get_conn() as conn:
    conn.execute("INSERT INTO users(id,email,pw_hash,pw_salt,created_at,plan) "
                 "VALUES(1,'a@t.co','x','s',?,'pro')", (db.now_iso(),))
    sid = conn.execute("INSERT INTO shops(user_id,name,created_at) VALUES(1,'Main',?)",
                       (db.now_iso(),)).lastrowid
    conn.execute("UPDATE users SET active_shop_id=? WHERE id=1", (sid,))
    rice = conn.execute(
        "INSERT INTO products(user_id,shop_id,name,unit_price,unit_cost,stock_qty,created_at) "
        "VALUES(1,?,'Bag of Rice',78000,70000,10,?)", (sid, db.now_iso())).lastrowid
    db.create_session(conn, "sess", 1)

c = TestClient(main.app)
c.cookies.set(auth.COOKIE_NAME, "sess")

TRANSCRIPT = "Good afternoon, please send me two bags of rice and one keg of palm oil. This is Chinedu."
ai.transcribe_audio = lambda *a, **k: {"ok": True, "text": TRANSCRIPT}
ai.available = lambda: True
ai.parse_sale = lambda *a, **k: {"ok": True, "sale": {
    "items": [
        {"product_id": rice, "description": "Bag of Rice", "qty": 2, "unit_price": 78000},
        {"product_id": 0, "description": "Keg of palm oil", "qty": 1, "unit_price": 9000},
        {"product_id": 0, "description": "misheard noise", "qty": 0, "unit_price": 0},
    ],
    "customer_name": "Chinedu", "payment": "unknown"}}

r = c.post("/api/orders/from-voice", files={"audio": ("note.ogg", b"fake-opus-bytes", "audio/ogg")})
assert r.status_code == 200, r.text
oid = r.json()["order_id"]
assert r.json()["total"] == 2 * 78000 + 9000, r.json()
assert r.json()["transcript"] == TRANSCRIPT

# ---- it lands in the SAME pending inbox as storefront orders ----
pending = c.get("/api/orders/pending").json()
assert [o["id"] for o in pending] == [oid], pending
o = pending[0]
assert o["customer_name"] == "Chinedu"
assert TRANSCRIPT in o["note"], "the raw transcript is kept so the merchant can check"
assert [(i["description"], i["qty"]) for i in o["items"]] == \
       [("Bag of Rice", 2), ("Keg of palm oil", 1)], "zero-qty noise must be dropped"
# catalog match carries the real cost (profit math); off-catalog line has none
assert [i["unit_cost"] for i in o["items"]] == [70000, 0]
assert o["items"][1]["product_id"] is None, "off-catalog item stores NULL, not 0"

# ---- asking for more than stock is NOT silently capped: merchant decides ----
assert o["items"][0]["qty"] == 2

# ---- fulfil turns it into a real invoice and moves stock ----
f = c.post(f"/api/orders/{oid}/fulfill")
assert f.status_code == 200, f.text
with db.get_conn() as conn:
    assert conn.execute("SELECT stock_qty FROM products WHERE id=?", (rice,)).fetchone()[0] == 8
    inv = conn.execute("SELECT * FROM invoices WHERE id=?", (f.json()["invoice_id"],)).fetchone()
    assert inv["total"] == 2 * 78000 + 9000
    assert conn.execute("SELECT status FROM orders WHERE id=?", (oid,)).fetchone()[0] == "fulfilled"

# ---- a voice note with no audible items is refused, not stored as an empty order ----
ai.parse_sale = lambda *a, **k: {"ok": True, "sale": {"items": [], "customer_name": "", "payment": "unknown"}}
r = c.post("/api/orders/from-voice", files={"audio": ("n.ogg", b"x", "audio/ogg")})
assert r.status_code == 400, r.status_code
with db.get_conn() as conn:
    assert conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0] == 1, "no empty order written"

# ---- a bad recording surfaces as an error, not a silent empty order ----
ai.transcribe_audio = lambda *a, **k: {"ok": False, "error": "Couldn't hear that clearly"}
assert c.post("/api/orders/from-voice", files={"audio": ("n.ogg", b"x", "audio/ogg")}).status_code == 503
assert c.post("/api/orders/from-voice", files={"audio": ("n.ogg", b"", "audio/ogg")}).status_code == 400

print("ok")
