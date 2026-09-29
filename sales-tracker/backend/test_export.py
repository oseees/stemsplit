"""Check for /api/export: the owner's records come out complete, another
tenant's never do, and formula-looking text can't run in Excel.
Run: .venv/bin/python test_export.py
"""
import csv
import io
import os
import re
import tempfile
import zipfile

os.environ["SALESPAL_DB"] = os.path.join(tempfile.mkdtemp(), "t.db")

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

c = TestClient(main.app)


def auth(email):
    r = c.post("/api/auth/register", json={"email": email, "password": "pw123456", "name": "X"})
    assert r.status_code == 200, r.text
    return {"Cookie": re.search(r"(sp_session=[^;]+)", r.headers["set-cookie"]).group(1)}


def sale(h, customer, desc, qty, price, cost, paid=None):
    r = c.post("/api/invoices", headers=h, json={
        "customer_name": customer,
        "items": [{"description": desc, "qty": qty, "unit_price": price, "unit_cost": cost}]})
    assert r.status_code == 200, r.text
    iid = r.json()["id"]
    if paid:
        assert c.post(f"/api/invoices/{iid}/payments", headers=h,
                      json={"amount": paid, "method": "cash"}).status_code == 200
    return iid


a, b = auth("a@test.local"), auth("b@test.local")
sale(a, "Ada", "Rice", 3, 5000, 3000, paid=5000)            # 15,000 total, 10,000 owed
sale(a, "=HYPERLINK(\"http://x\")", "Beans", 1, 2000, 1500)  # hostile name from an order link
c.post("/api/expenses", headers=a, json={"amount": 1200, "category": "Transport",
                                        "date": "2026-09-01", "description": "Keke"})
sale(b, "Secret Customer", "B-only item", 1, 99999, 1)      # other tenant

r = c.get("/api/export", headers=a)
assert r.status_code == 200, r.text
assert r.headers["content-type"] == "application/zip"
assert "attachment" in r.headers["content-disposition"]
z = zipfile.ZipFile(io.BytesIO(r.content))
assert sorted(z.namelist()) == sorted(f"{n}.csv" for n in main._EXPORT_SQL), z.namelist()

everything = "".join(z.read(n).decode("utf-8-sig") for n in z.namelist())
assert "Secret Customer" not in everything and "B-only item" not in everything, "tenant leak!"


def rows(name):
    return list(csv.DictReader(io.StringIO(z.read(name).decode("utf-8-sig"))))


sales = rows("sales.csv")
rice = [s for s in sales if s["customer"] == "Ada"][0]
assert float(rice["total"]) == 15000 and float(rice["paid"]) == 5000, rice
assert float(rice["balance"]) == 10000 and float(rice["profit"]) == 6000, rice
names = [s["customer"] for s in sales]
assert "'=HYPERLINK(\"http://x\")" in names, ("formula must be neutralised", names)
assert len(rows("sale_items.csv")) == 2 and len(rows("payments.csv")) == 1
exp = rows("expenses.csv")
assert len(exp) == 1 and float(exp[0]["amount"]) == 1200, exp
ada = [x for x in rows("customers.csv") if x["name"] == "Ada"][0]
assert float(ada["balance_owed"]) == 10000, ada
print("export OK:", {n: len(rows(n)) for n in z.namelist()})

assert c.get("/api/export").status_code == 401, "must require sign-in"
print("all export checks passed")
