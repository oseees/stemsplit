"""Runnable check for the customer debt book (/api/customers `owed`):
per-customer rollup, overpaid invoices don't cancel real debts, shop scoping.
Run: python test_debt_book.py"""
import os, tempfile
os.environ["SALESPAL_DB"] = tempfile.mkstemp(suffix=".db")[1]

import db; db.init_db()
import main

TODAY = main.today()


def _cust(conn, uid, shop, name):
    return conn.execute(
        "INSERT INTO customers(user_id,shop_id,name,created_at) VALUES(?,?,?,?)",
        (uid, shop, name, TODAY)).lastrowid


def _sale(conn, uid, shop, cid, total, paid=0):
    iid = conn.execute(
        "INSERT INTO invoices(user_id,shop_id,invoice_no,customer_id,date,status,total,created_at) "
        "VALUES(?,?,?,?,?,'unpaid',?,?)", (uid, shop, "INV", cid, TODAY, total, TODAY)).lastrowid
    if paid:
        conn.execute("INSERT INTO payments(invoice_id,amount,method,date) VALUES(?,?,?,?)",
                     (iid, paid, "cash", TODAY))


with db.get_conn() as conn:
    chidi = _cust(conn, 1, 1, "Chidi")
    ada = _cust(conn, 1, 1, "Ada")
    paid_up = _cust(conn, 1, 1, "Bola")
    other_shop = _cust(conn, 1, 2, "Musa")
    other_user = _cust(conn, 2, 1, "Not mine")

    _sale(conn, 1, 1, chidi, 100_000)             # fully owed
    _sale(conn, 1, 1, chidi, 100_000, 40_000)     # 60k left  -> 160k, 2 unpaid
    _sale(conn, 1, 1, ada, 50_000, 70_000)        # OVERPAID by 20k
    _sale(conn, 1, 1, ada, 30_000)                # 30k owed
    _sale(conn, 1, 1, paid_up, 10_000, 10_000)    # settled
    _sale(conn, 1, 2, other_shop, 5_000)          # different shop
    _sale(conn, 2, 1, other_user, 999_000)        # different tenant


def rows(user):
    return {r["name"]: r for r in main.list_customers(user=user)}


# --- All-shops view (active_shop_id 0) ---
r = rows({"id": 1, "active_shop_id": 0})
assert abs(r["Chidi"]["owed"] - 160_000) < 0.01, r["Chidi"]["owed"]
assert r["Chidi"]["unpaid_count"] == 2, r["Chidi"]["unpaid_count"]
# the 20k overpayment on one invoice must NOT wipe out the 30k owed on the other
assert abs(r["Ada"]["owed"] - 30_000) < 0.01, r["Ada"]["owed"]
assert r["Ada"]["unpaid_count"] == 1, r["Ada"]["unpaid_count"]
assert r["Bola"]["owed"] == 0 and r["Bola"]["unpaid_count"] == 0
assert "Not mine" not in r, "leaked another tenant's customer"
# biggest debtor first, settled customers last
names = [c["name"] for c in main.list_customers(user={"id": 1, "active_shop_id": 0})]
assert names[0] == "Chidi" and names[1] == "Ada", names

# --- Scoped to shop 1: Musa's shop-2 debt is out of scope entirely ---
r1 = rows({"id": 1, "active_shop_id": 1})
assert "Musa" not in r1, "shop filter leaked another shop's customer"
assert abs(r1["Chidi"]["owed"] - 160_000) < 0.01

# --- Scoped to shop 2 ---
r2 = rows({"id": 1, "active_shop_id": 2})
assert list(r2) == ["Musa"], list(r2)
assert abs(r2["Musa"]["owed"] - 5_000) < 0.01

print("ok")
