"""Check for the mini-store: readable /s/<slug> links, their rules, and that the
server-rendered store page can't be used to inject HTML.
Run: .venv/bin/python test_store.py
"""
import os
import re
import tempfile

os.environ["SALESPAL_DB"] = os.path.join(tempfile.mkdtemp(), "t.db")

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

c = TestClient(main.app)


def auth(email, biz, pro=True):
    r = c.post("/api/auth/register", json={"email": email, "password": "pw123456", "business_name": biz})
    assert r.status_code == 200, r.text
    if pro:
        with main.db.get_conn() as conn:
            conn.execute("UPDATE users SET plan='pro' WHERE email=?", (email,))
    return {"Cookie": re.search(r"(sp_session=[^;]+)", r.headers["set-cookie"]).group(1)}


def shop_name(h, name):
    sid = c.get("/api/shops", headers=h).json()["active_shop_id"]
    with main.db.get_conn() as conn:
        conn.execute("UPDATE shops SET name=? WHERE id=?", (name, sid))


a = auth("a@test.local", "Ada")
shop_name(a, "Ada Fabrics & Co.")
c.post("/api/products", headers=a, json={"name": "Ankara", "unit_price": 12500, "unit_cost": 8000, "stock_qty": 4})

# enabling gives a readable link made from the shop name
st = c.post("/api/orders/enable", headers=a).json()
assert st["slug"] == "ada-fabrics-co" and st["url"].endswith("/s/ada-fabrics-co"), st

# a second shop with the same name gets -2, never a clash
b = auth("b@test.local", "Ada2")
shop_name(b, "Ada Fabrics & Co.")
assert c.post("/api/orders/enable", headers=b).json()["slug"] == "ada-fabrics-co-2"

# owner can rename; bad and taken names are refused
r = c.post("/api/orders/store", headers=a, json={"slug": "ada-fabrics", "tagline": "Ankara & Aso-ebi"})
assert r.status_code == 200 and r.json()["slug"] == "ada-fabrics" and r.json()["tagline"] == "Ankara & Aso-ebi", r.text
for bad in ("a", "has space", "UPPER!", "-dash-first", "x" * 41):
    assert c.post("/api/orders/store", headers=b, json={"slug": bad}).status_code == 400, bad
assert c.post("/api/orders/store", headers=b, json={"slug": "ada-fabrics"}).status_code == 400, "taken"

# both link styles reach the same public store; photos/orders work by link name
with main.db.get_conn() as conn:
    token = conn.execute("SELECT order_token FROM shops WHERE slug='ada-fabrics'").fetchone()["order_token"]
by_slug, by_token = c.get("/api/shop/ada-fabrics").json(), c.get(f"/api/shop/{token}").json()
assert by_slug == by_token and by_slug["tagline"] == "Ankara & Aso-ebi", by_slug
pid = by_slug["products"][0]["id"]
r = c.post("/api/shop/ada-fabrics/order", json={"customer_name": "Bola", "items": [{"product_id": pid, "qty": 2}]})
assert r.status_code == 200 and r.json()["total"] == 25000, r.text

# the store page carries the shop's own title/preview and is indexable; token links stay noindex
page = c.get("/s/ada-fabrics").text
assert "<title>Ada Fabrics &amp; Co. — order online</title>" in page, page[:600]
assert 'og:image" content="http://testserver/api/shop/ada-fabrics/card.jpg"' in page
assert 'content="noindex"' not in page
assert 'content="noindex"' in c.get(f"/order/{token}").text
card = c.get("/api/shop/ada-fabrics/card.jpg")
assert card.status_code == 200 and card.headers["content-type"] == "image/jpeg", card.status_code

# hostile shop name / description can't break out of the meta tags
shop_name(b, '"><script>alert(1)</script>')
c.post("/api/orders/store", headers=b, json={"slug": "evil-shop", "tagline": '"><img src=x onerror=alert(2)>'})
evil = c.get("/s/evil-shop").text
assert "<script>alert(1)" not in evil and "<img src=x" not in evil, "meta injection!"

# a store opened before link names existed gets one the next time the owner looks
with main.db.get_conn() as conn:
    conn.execute("UPDATE shops SET slug=NULL WHERE slug='ada-fabrics'")
st = c.get("/api/orders/status", headers=a).json()
assert st["slug"] == "ada-fabrics-co" and st["url"].endswith("/s/ada-fabrics-co"), st

# turned off → gone; free plan can't open a store
c.post("/api/orders/disable", headers=a)
assert c.get("/api/shop/ada-fabrics-co").status_code == 404
assert 'content="noindex"' in c.get("/s/ada-fabrics-co").text, "a closed store isn't indexable"
free = auth("f@test.local", "Free", pro=False)
assert c.post("/api/orders/enable", headers=free).status_code == 402
assert c.post("/api/orders/store", headers=free, json={"slug": "free-shop"}).status_code == 402
print("all store checks passed")
