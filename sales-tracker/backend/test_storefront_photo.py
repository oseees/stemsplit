"""Runnable check for the public storefront photo route: the link token is the
only key, so it must serve ONLY that shop's products. Run: python test_storefront_photo.py"""
import os, tempfile
os.environ["SALESPAL_DB"] = tempfile.mkstemp(suffix=".db")[1]

import db; db.init_db()
import main
from fastapi.testclient import TestClient

c = TestClient(main.app)

with db.get_conn() as conn:
    def mkshop(email, shop_name, token, product, photo):
        conn.execute("INSERT INTO users(email,pw_hash,pw_salt,created_at) VALUES(?,?,?,?)",
                     (email, "h", "s", db.now_iso()))
        uid = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()["id"]
        sid = conn.execute(
            "INSERT INTO shops(user_id,name,created_at,order_token,orders_enabled) "
            "VALUES(?,?,?,?,1)", (uid, shop_name, db.now_iso(), token)).lastrowid
        pid = conn.execute(
            "INSERT INTO products(user_id,shop_id,name,unit_price,stock_qty,photo,created_at) "
            "VALUES(?,?,?,?,?,?,?)", (uid, sid, product, 500, 4, photo, db.now_iso())).lastrowid
        return uid, sid, pid

    a_uid, _, a_pid = mkshop("a@t.co", "Shop A", "tok-a", "Rice", f"{1}.jpg")
    b_uid, _, b_pid = mkshop("b@t.co", "Shop B", "tok-b", "Beans", f"{2}.jpg")

# real files on disk, so a 404 means "refused", never "missing file"
for pid in (a_pid, b_pid):
    with open(os.path.join(main.PHOTOS_DIR, f"{pid}.jpg"), "wb") as f:
        f.write(b"\xff\xd8\xff\xdb-not-a-real-jpeg-but-served-as-bytes")
with db.get_conn() as conn:
    for pid in (a_pid, b_pid):
        conn.execute("UPDATE products SET photo=? WHERE id=?", (f"{pid}.jpg", pid))

# ---- the listing exposes photo presence + the merchant's phone, not the path ----
r = c.get("/api/shop/tok-a")
assert r.status_code == 200, r.text
body = r.json()
assert [p["name"] for p in body["products"]] == ["Rice"]
assert body["products"][0]["photo"] is True
assert "phone" in body
assert "photo" not in str(body["products"][0].get("photo_path", ""))

# ---- a shop's own photo is served ----
assert c.get(f"/api/shop/tok-a/photo/{a_pid}").status_code == 200

# ---- another shop's product is NOT, even though the file exists ----
assert c.get(f"/api/shop/tok-a/photo/{b_pid}").status_code == 404
assert c.get(f"/api/shop/tok-b/photo/{a_pid}").status_code == 404

# ---- bad/disabled token gets nothing ----
assert c.get(f"/api/shop/nope/photo/{a_pid}").status_code == 404
with db.get_conn() as conn:
    conn.execute("UPDATE shops SET orders_enabled=0 WHERE order_token='tok-a'")
assert c.get(f"/api/shop/tok-a/photo/{a_pid}").status_code == 404

print("ok")
