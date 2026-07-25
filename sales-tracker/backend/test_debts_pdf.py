"""Runnable check for the debtors statement (/api/debts/pdf):
grouping, overpaid invoices, walk-in sales, shop scoping, awkward names.
Run: python test_debts_pdf.py"""
import os, tempfile
os.environ["SALESPAL_DB"] = tempfile.mkstemp(suffix=".db")[1]

import db; db.init_db()
import main

TODAY = main.today()
LATE = "2020-01-01"


def _cust(conn, uid, shop, name, phone=None):
    return conn.execute(
        "INSERT INTO customers(user_id,shop_id,name,phone,created_at) VALUES(?,?,?,?,?)",
        (uid, shop, name, phone, TODAY)).lastrowid


def _sale(conn, uid, shop, cid, no, total, paid=0, due=None):
    iid = conn.execute(
        "INSERT INTO invoices(user_id,shop_id,invoice_no,customer_id,date,due_date,status,total,"
        "created_at) VALUES(?,?,?,?,?,?,'unpaid',?,?)",
        (uid, shop, no, cid, TODAY, due, total, TODAY)).lastrowid
    if paid:
        conn.execute("INSERT INTO payments(invoice_id,amount,method,date) VALUES(?,?,?,?)",
                     (iid, paid, "cash", TODAY))


with db.get_conn() as conn:
    chidi = _cust(conn, 1, 1, "Chidi & Sons", "08011112222")
    ada = _cust(conn, 1, 1, "Ada")
    bola = _cust(conn, 1, 1, "Bola")
    musa = _cust(conn, 1, 2, "Musa")
    theirs = _cust(conn, 2, 1, "Not mine")

    _sale(conn, 1, 1, chidi, "INV-1", 100_000, due=LATE)      # 100k, overdue
    _sale(conn, 1, 1, chidi, "INV-2", 100_000, 40_000)        # 60k left -> 160k
    _sale(conn, 1, 1, ada, "INV-3", 50_000, 70_000)           # OVERPAID by 20k
    _sale(conn, 1, 1, ada, "INV-4", 30_000)                   # 30k owed
    _sale(conn, 1, 1, bola, "INV-5", 10_000, 10_000)          # settled
    _sale(conn, 1, 1, None, "INV-6", 7_000)                   # walk-in, no customer
    _sale(conn, 1, 2, musa, "INV-7", 5_000)                   # other shop
    _sale(conn, 2, 1, theirs, "INV-8", 999_000)               # other tenant

USER = {"id": 1, "active_shop_id": 0}


def groups(user, customer_id=0):
    """Re-run the endpoint's grouping by monkeypatching the PDF builder."""
    seen = {}
    real = main.build_debts_pdf
    main.build_debts_pdf = lambda d, s, a, title="": (
        seen.update(d=d, as_of=a, title=title, pay_to=s.get("pay_to")), b"%PDF-fake")[1]
    try:
        main.debts_pdf(customer_id=customer_id, user=user)
    finally:
        main.build_debts_pdf = real
    return {g["name"]: g for g in seen["d"]}, seen["d"], seen


by_name, ordered, meta = groups(USER)
assert meta["title"] == "WHO OWES ME", meta["title"]
assert abs(by_name["Chidi & Sons"]["owed"] - 160_000) < 0.01, by_name["Chidi & Sons"]["owed"]
assert len(by_name["Chidi & Sons"]["invoices"]) == 2
# the 20k overpayment on INV-3 must not wipe out the 30k owed on INV-4
assert abs(by_name["Ada"]["owed"] - 30_000) < 0.01, by_name["Ada"]["owed"]
assert [i["invoice_no"] for i in by_name["Ada"]["invoices"]] == ["INV-4"]
assert "Bola" not in by_name, "settled customer should not appear"
assert "Not mine" not in by_name, "leaked another tenant"
assert None in by_name, "walk-in debt missing"  # no customer row -> name is NULL
assert abs(by_name[None]["owed"] - 7_000) < 0.01
assert [g["name"] for g in ordered][:2] == ["Chidi & Sons", "Ada"], "not biggest-first"

# overdue flag: INV-1 is years past due, INV-2 has no due date
late = {i["invoice_no"]: i["days_late"] for i in by_name["Chidi & Sons"]["invoices"]}
assert late["INV-1"] > 1000 and late["INV-2"] == 0, late

# shop scoping
assert "Musa" not in groups({"id": 1, "active_shop_id": 1})[0]
assert list(groups({"id": 1, "active_shop_id": 2})[0]) == ["Musa"]

# --- one customer: a statement to send THEM ---
one, ordered1, meta1 = groups(USER, customer_id=chidi)
assert list(one) == ["Chidi & Sons"], list(one)
assert abs(one["Chidi & Sons"]["owed"] - 160_000) < 0.01
assert meta1["title"] == "STATEMENT OF ACCOUNT", meta1["title"]
# transfer not enabled for this user -> no bank box
assert meta1["pay_to"] is None, meta1["pay_to"]
# filename is named after them
hdr = main.debts_pdf(customer_id=chidi, user=USER).headers["content-disposition"]
assert 'filename="statement-chidi-sons.pdf"' in hdr, hdr

# another tenant's customer id must not resolve, even with a valid-looking id
try:
    main.debts_pdf(customer_id=theirs, user=USER)
    raise AssertionError("leaked another tenant's customer")
except main.HTTPException as e:
    assert e.status_code == 400, e.status_code
# neither may a settled one
try:
    main.debts_pdf(customer_id=bola, user=USER)
    raise AssertionError("expected 400 for a customer who owes nothing")
except main.HTTPException as e:
    assert e.status_code == 400

# nothing owed -> a 400, not an empty PDF
try:
    main.debts_pdf(user={"id": 3, "active_shop_id": 0})
    raise AssertionError("expected HTTPException for a user owed nothing")
except main.HTTPException as e:
    assert e.status_code == 400, e.status_code

# and the real builder produces a PDF, with "&" in a name and a NULL walk-in name
out = main.debts_pdf(user=USER).body
assert out[:5] == b"%PDF-" and len(out) > 3000, len(out)
assert main.debts_pdf(customer_id=chidi, user=USER).body[:5] == b"%PDF-"

# bank box lands on a single-customer statement when transfer is on
with db.get_conn() as conn:
    # bank_accounts has an FK to users, so user 1 has to actually exist here
    conn.execute("INSERT INTO users(id,email,pw_hash,pw_salt,created_at) "
                 "VALUES(1,'a@b.c','x','y',?)", (TODAY,))
    conn.execute("INSERT INTO bank_accounts(user_id,bank,number,name,is_default,created_at) "
                 "VALUES(1,'GTBank','0123456789','Oseabhi Trading',1,?)", (TODAY,))
pay = groups({"id": 1, "active_shop_id": 0, "transfer_enabled": 1}, customer_id=chidi)[2]["pay_to"]
assert pay and pay["number"] == "0123456789", pay
# ...but never on the merchant's own all-customers debt book
assert groups({"id": 1, "active_shop_id": 0, "transfer_enabled": 1})[2]["pay_to"] is None

print("ok")
