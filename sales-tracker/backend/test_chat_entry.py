"""Check for the SalesPal bot (/api/chat/entry): parsed entry → real records.

The AI call itself is stubbed — what needs guarding is OUR mapping of Claude's
output onto create_invoice/create_expense (money path). Run: .venv/bin/python test_chat_entry.py
"""
import os
import tempfile
import re

os.environ["SALESPAL_DB"] = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["ANTHROPIC_API_KEY"] = "test-key"   # only makes ai.available() true

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

c = TestClient(main.app)


def auth(email):
    r = c.post("/api/auth/register", json={"email": email, "password": "pw123456", "name": "X"})
    assert r.status_code == 200, r.text
    m = re.search(r"(sp_session=[^;]+)", r.headers.get("set-cookie", ""))
    assert m, "no session cookie"
    return {"Cookie": m.group(1)}


def stub(kind, data):
    main.ai.parse_entry = lambda *a, **k: {"ok": True, "kind": kind, "data": data}


h = auth("bot@test.local")
# Pro: this suite makes more than the 5 free AI entries a month, and the
# quota isn't what these checks are for.
with main.db.get_conn() as conn:
    conn.execute("UPDATE users SET plan='pro' WHERE email=?", ("bot@test.local",))
pid = c.post("/api/products", json={"name": "Rice", "unit_price": 5000,
                                    "unit_cost": 3000, "stock_qty": 10}, headers=h).json()["id"]

# --- a catalog sale, paid cash -------------------------------------------------
stub("sale", {"items": [{"product_id": pid, "description": "Rice", "qty": 3, "unit_price": 5000}],
              "customer_name": "Mrs Okoro", "payment": "cash"})
r = c.post("/api/chat/entry", json={"text": "sold 3 bags of rice 5000 each cash"}, headers=h)
assert r.status_code == 200, r.text
assert r.json()["kind"] == "sale", r.json()
inv = c.get(f"/api/invoices/{r.json()['invoice_id']}", headers=h).json()
assert inv["total"] == 15000, ("total", inv["total"])
assert inv["status"] == "paid" and inv["balance"] == 0, ("should be paid", inv["status"], inv["balance"])
assert inv["items"][0]["unit_cost"] == 3000, ("cost carried for profit", inv["items"][0])
assert (inv.get("customer") or {}).get("name") == "Mrs Okoro", inv.get("customer")
stock = [p for p in c.get("/api/products", headers=h).json() if p["id"] == pid][0]["stock_qty"]
assert stock == 7, ("stock must decrement like a hand-entered sale", stock)
print("sale  OK ->", r.json()["reply"])

# --- an owing sale stays unpaid ------------------------------------------------
stub("sale", {"items": [{"product_id": 0, "description": "Bread", "qty": 2, "unit_price": 700}],
              "customer_name": "", "payment": "owing"})
r = c.post("/api/chat/entry", json={"text": "2 bread 700 each, he will pay later"}, headers=h)
inv = c.get(f"/api/invoices/{r.json()['invoice_id']}", headers=h).json()
assert inv["total"] == 1400 and inv["status"] == "unpaid", (inv["total"], inv["status"])
assert inv["items"][0]["product_id"] in (None, 0), "product_id 0 = custom line item"
print("owing OK ->", r.json()["reply"])

# --- an expense ----------------------------------------------------------------
stub("expense", {"amount": 2000, "category": "Transport", "description": "bus to market"})
r = c.post("/api/chat/entry", json={"text": "spent 2000 on transport"}, headers=h)
assert r.status_code == 200 and r.json()["kind"] == "expense", r.text
exp = c.get("/api/expenses", headers=h).json()
assert len(exp) == 1 and exp[0]["amount"] == 2000 and exp[0]["category"] == "Transport", exp
print("expense OK ->", r.json()["reply"])

# --- junk in, no record out ----------------------------------------------------
stub("sale", {"items": [], "customer_name": "", "payment": "unknown"})
assert c.post("/api/chat/entry", json={"text": "hello"}, headers=h).status_code == 400
stub("expense", {"amount": 0, "category": "Other", "description": "?"})
assert c.post("/api/chat/entry", json={"text": "i spent money"}, headers=h).status_code == 400
assert len(c.get("/api/invoices", headers=h).json()) == 2, "no junk invoice created"
assert len(c.get("/api/expenses", headers=h).json()) == 1, "no junk expense created"
print("junk rejected OK")


# --- the customer list is capped so prompt cost stays flat as a shop ages ------
uid = c.get("/api/auth/me", headers=h).json()["id"]
with main.db.get_conn() as conn:
    for i in range(1, 151):
        conn.execute("INSERT INTO customers(user_id,name,created_at) VALUES(?,?,?)",
                     (uid, f"Walkin {i}", main.db.now_iso()))
sf, sp = main._shop_and(0)
with main.db.get_conn() as conn:
    plain = main._ai_customer_names(conn, uid, sf, sp)
    named = main._ai_customer_names(conn, uid, sf, sp, "sold rice to Walkin 3 today")
assert len(plain) == main.AI_CUSTOMER_LIMIT, ("capped", len(plain))
assert "Walkin 150" in plain, "must keep the most recent"
assert "Walkin 3" not in plain, "an old walk-in shouldn't be sent by default"
assert "Walkin 3" in named, "but must come back when the message names them"
assert len(named) == len(set(n.lower() for n in named)), "no duplicates"
print(f"customer cap OK -> {len(plain)} names from 151, old match pulled in on mention")

# --- part payment on a new sale -----------------------------------------------
stub("sale", {"items": [{"product_id": pid, "description": "Rice", "qty": 3, "unit_price": 5000}],
              "customer_name": "Ada Part", "payment": "cash", "amount_paid": 5000})
r = c.post("/api/chat/entry", json={"text": "sold 3 rice to Ada Part, she paid 5000"}, headers=h)
assert r.status_code == 200, r.text
inv = c.get(f"/api/invoices/{r.json()['invoice_id']}", headers=h).json()
assert (inv["total"], inv["paid"], inv["balance"]) == (15000, 5000, 10000), inv
assert inv["status"] == "partial", inv["status"]
print("part payment on sale OK ->", r.json()["reply"])

# --- a customer paying down an existing debt ----------------------------------
stub("payment", {"customer_name": "Ada Part", "amount": 4000, "method": "cash"})
r = c.post("/api/chat/entry", json={"text": "Ada Part paid 4000"}, headers=h)
assert r.status_code == 200 and r.json()["kind"] == "payment", r.text
inv = c.get(f"/api/invoices/{r.json()['invoice_id']}", headers=h).json()
assert (inv["paid"], inv["balance"]) == (9000, 6000), (inv["paid"], inv["balance"])
print("debt payment OK ->", r.json()["reply"])

# --- overpaying records only what was owed, and says so -----------------------
stub("payment", {"customer_name": "Ada Part", "amount": 10000, "method": "cash"})
r = c.post("/api/chat/entry", json={"text": "Ada Part paid 10000"}, headers=h)
inv = c.get(f"/api/invoices/{r.json()['invoice_id']}", headers=h).json()
assert inv["balance"] == 0 and inv["status"] == "paid", (inv["balance"], inv["status"])
assert "more than they owed" in r.json()["reply"], r.json()["reply"]
print("overpay OK ->", r.json()["reply"])

# --- paying when nothing is outstanding is refused ----------------------------
stub("payment", {"customer_name": "Ada Part", "amount": 1000, "method": "cash"})
assert c.post("/api/chat/entry", json={"text": "Ada Part paid 1000"}, headers=h).status_code == 400
print("no-debt payment refused OK")

print("\nall chat-entry checks passed")
