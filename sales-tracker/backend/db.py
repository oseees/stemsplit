"""SQLite data layer for SalesPal. Pure stdlib sqlite3, no ORM, easy to host later.

Multi-tenant: every business-data row carries a user_id, and settings are per-user.
"""
import sqlite3
import os
from datetime import datetime
from contextlib import contextmanager

DB_PATH = os.environ.get("SALESPAL_DB", os.path.join(os.path.dirname(__file__), "data", "salespal.db"))

# Tables that hold per-user business data (scoped by a user_id column).
USER_SCOPED_TABLES = ("products", "customers", "invoices", "expenses", "reports")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  business_name TEXT,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY(user_id, key)
);

CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT NOT NULL,
  sku TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  stock_qty REAL NOT NULL DEFAULT 0,
  low_stock_at REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  invoice_no TEXT NOT NULL,
  customer_id INTEGER,
  date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid',
  notes TEXT,
  total REAL NOT NULL DEFAULT 0,
  cost_total REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  product_id INTEGER,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  method TEXT,
  note TEXT,
  FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  category TEXT,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  type TEXT NOT NULL,
  period_key TEXT,
  title TEXT,
  content TEXT,
  metrics TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_events (
  reference TEXT PRIMARY KEY,
  user_id INTEGER,
  amount INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  amount REAL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

-- Suppliers a product can be reordered from. A product can have several, so
-- this is a child table (one row per supplier) rather than columns on products.
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  name TEXT,
  phone TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Customer orders placed through a shop's public storefront link. They arrive
-- 'pending'; the merchant fulfills (→ creates an invoice + reduces stock) or
-- declines. Header + line-items mirror the invoices/invoice_items pair.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  shop_id INTEGER NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | fulfilled | declined
  total REAL NOT NULL DEFAULT 0,
  invoice_id INTEGER,                        -- the invoice created on fulfil
  created_at TEXT NOT NULL
);

-- Web-push subscriptions (new-order alerts). One row per device/browser; the
-- endpoint URL is unique, re-subscribing the same device just refreshes it.
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT UNIQUE NOT NULL,
  sub TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Shop attendants: limited logins that operate INSIDE an owner's business, for
-- one shop. They record sales & see stock only — no profit/settings/insights.
-- Their data lives under owner_id (they don't own a tenant of their own).
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  shop_id INTEGER NOT NULL,
  name TEXT,
  username TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  description TEXT,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
"""

DEFAULT_SETTINGS = {
    "business_name": "My Business",
    "currency": "₦",
    "address": "",
    "phone": "",
    "email": "",
}


def now_iso():
    return datetime.utcnow().isoformat()


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def backup_bytes():
    """Consistent snapshot of the whole DB as bytes, safe while writes happen
    (sqlite's online backup API). ponytail: whole file in memory — fine for a
    small-business DB; stream from a temp file if it ever grows past ~100MB."""
    import tempfile
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        dest = sqlite3.connect(path)
        with get_conn() as conn:
            conn.backup(dest)
        dest.close()
        with open(path, "rb") as f:
            return f.read()
    finally:
        os.remove(path)


def _ensure_column(conn, table, column, decl):
    cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        # migrations for databases created before these columns existed
        _ensure_column(conn, "products", "low_stock_at", "REAL NOT NULL DEFAULT 0")
        # suppliers are looked up by product — index the FK for fast joins
        conn.execute("CREATE INDEX IF NOT EXISTS idx_suppliers_product ON suppliers(product_id)")
        # per-shop monthly profit goal (0 = none). Each shop tracks its own.
        _ensure_column(conn, "shops", "profit_goal", "REAL NOT NULL DEFAULT 0")
        # public storefront (orders): each shop has its own share link + on/off.
        _ensure_column(conn, "shops", "order_token", "TEXT")
        _ensure_column(conn, "shops", "orders_enabled", "INTEGER NOT NULL DEFAULT 0")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_shop ON orders(shop_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)")
        # attendant logins: a session may belong to a staff member (still under
        # the owner's user_id, so all data scoping keeps working unchanged).
        _ensure_column(conn, "sessions", "staff_id", "INTEGER")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_staff_owner ON staff(owner_id)")
        # one-time: v51 stored a single per-USER goal in user_settings. Move each
        # user's goal onto their first shop (only where that shop has none yet),
        # then drop the orphaned key so it can't re-apply on a later boot.
        conn.execute(
            "UPDATE shops SET profit_goal = CAST(("
            "  SELECT us.value FROM user_settings us"
            "  WHERE us.user_id = shops.user_id AND us.key = 'profit_goal') AS REAL) "
            "WHERE profit_goal = 0 "
            "  AND id IN (SELECT MIN(id) FROM shops GROUP BY user_id) "
            "  AND EXISTS (SELECT 1 FROM user_settings us WHERE us.user_id = shops.user_id "
            "              AND us.key = 'profit_goal' AND CAST(us.value AS REAL) > 0)")
        conn.execute("DELETE FROM user_settings WHERE key = 'profit_goal'")
        # subscription plan (Phase 1 paywall): 'free' | 'pro'; expires reserved for billing
        _ensure_column(conn, "users", "plan", "TEXT NOT NULL DEFAULT 'free'")
        _ensure_column(conn, "users", "plan_expires_at", "TEXT")
        # early-bird founding members: locked-in low yearly rate (limited slots)
        _ensure_column(conn, "users", "early_bird", "INTEGER NOT NULL DEFAULT 0")
        # multi-shop: each user can run several shops; data rows carry a shop_id
        # and the user has a currently-active shop (0 = the "All shops" overview).
        _ensure_column(conn, "users", "active_shop_id", "INTEGER")
        # last time this account signed in (for the owner's usage dashboard)
        _ensure_column(conn, "users", "last_login_at", "TEXT")
        # first-touch acquisition (owner dashboard): channel bucket + raw referrer
        _ensure_column(conn, "users", "signup_source", "TEXT")
        _ensure_column(conn, "users", "signup_referrer", "TEXT")
        # Online payment collection (Pro): a Paystack subaccount settles the
        # merchant's own bank directly, so SalesPal never holds their money.
        _ensure_column(conn, "users", "pay_subaccount", "TEXT")
        _ensure_column(conn, "users", "pay_bank_code", "TEXT")
        _ensure_column(conn, "users", "pay_bank_name", "TEXT")
        _ensure_column(conn, "users", "pay_account_number", "TEXT")
        _ensure_column(conn, "users", "pay_account_name", "TEXT")
        _ensure_column(conn, "users", "pay_enabled", "INTEGER NOT NULL DEFAULT 0")
        # Direct bank transfer (instant, no processor): the account customers
        # transfer to, shown on the pay page; merchant confirms receipt manually.
        _ensure_column(conn, "users", "transfer_enabled", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(conn, "users", "transfer_bank", "TEXT")
        _ensure_column(conn, "users", "transfer_number", "TEXT")
        _ensure_column(conn, "users", "transfer_name", "TEXT")
        # per-invoice public pay link token + de-dup guard for Paystack-settled payments
        _ensure_column(conn, "invoices", "pay_token", "TEXT")
        _ensure_column(conn, "payments", "paystack_ref", "TEXT")
        for t in USER_SCOPED_TABLES:
            _ensure_column(conn, t, "user_id", "INTEGER")
            _ensure_column(conn, t, "shop_id", "INTEGER")
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{t}_user ON {t}(user_id)")
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{t}_shop ON {t}(shop_id)")
        # legacy global settings keep their defaults; copied into a user's
        # per-user settings when that user claims the pre-accounts data.
        for k, v in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)", (k, v)
            )
        # Default currency switched to ₦ (Naira). Flip accounts still on the old
        # "$" default only — anyone who deliberately chose another symbol is left
        # untouched.
        conn.execute("UPDATE user_settings SET value='₦' WHERE key='currency' AND value='$'")
        conn.execute("UPDATE settings SET value='₦' WHERE key='currency' AND value='$'")
        # Give every existing user a default shop and move their current data into
        # it, so nothing is lost when multi-shop turns on.
        _migrate_shops(conn)
    # invoice_no is unique per-user now; drop any legacy global UNIQUE constraint.
    _migrate_drop_invoice_unique()


def _migrate_shops(conn):
    """Ensure each user has a default shop and their unassigned data belongs to
    it, and set an active shop. Safe to run repeatedly (only fills gaps)."""
    for u in conn.execute("SELECT id, business_name FROM users").fetchall():
        row = conn.execute(
            "SELECT id FROM shops WHERE user_id=? ORDER BY id LIMIT 1", (u["id"],)).fetchone()
        if row:
            shop_id = row["id"]
        else:
            name = (u["business_name"] or "My Shop").strip() or "My Shop"
            shop_id = conn.execute(
                "INSERT INTO shops(user_id,name,created_at) VALUES(?,?,?)",
                (u["id"], name, now_iso())).lastrowid
        for t in USER_SCOPED_TABLES:
            conn.execute(
                f"UPDATE {t} SET shop_id=? WHERE user_id=? AND (shop_id IS NULL OR shop_id=0)",
                (shop_id, u["id"]))
        conn.execute(
            "UPDATE users SET active_shop_id=? WHERE id=? AND active_shop_id IS NULL",
            (shop_id, u["id"]))


def _migrate_drop_invoice_unique():
    """Older DBs declared invoices.invoice_no UNIQUE (global). With per-user
    numbering two businesses can share INV-1001, so rebuild the table without
    that constraint. No-op on fresh DBs (their schema already omits UNIQUE)."""
    conn = sqlite3.connect(DB_PATH)
    conn.isolation_level = None  # autocommit so PRAGMA foreign_keys takes effect
    conn.row_factory = sqlite3.Row
    try:
        need = False
        for idx in conn.execute("PRAGMA index_list(invoices)").fetchall():
            if idx["unique"]:
                cols = [r["name"] for r in
                        conn.execute(f"PRAGMA index_info({idx['name']})").fetchall()]
                if cols == ["invoice_no"]:
                    need = True
        if not need:
            return
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.executescript(
            """
            CREATE TABLE invoices_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER,
              invoice_no TEXT NOT NULL,
              customer_id INTEGER,
              date TEXT NOT NULL,
              due_date TEXT,
              status TEXT NOT NULL DEFAULT 'unpaid',
              notes TEXT,
              total REAL NOT NULL DEFAULT 0,
              cost_total REAL NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              FOREIGN KEY(customer_id) REFERENCES customers(id)
            );
            INSERT INTO invoices_new
              (id,user_id,invoice_no,customer_id,date,due_date,status,notes,total,cost_total,created_at)
              SELECT id, user_id,
                     COALESCE(invoice_no, 'INV-'||id),
                     customer_id,
                     COALESCE(date, created_at, '1970-01-01'),
                     due_date,
                     COALESCE(status, 'unpaid'),
                     notes,
                     COALESCE(total, 0),
                     COALESCE(cost_total, 0),
                     COALESCE(created_at, date, '1970-01-01')
              FROM invoices;
            DROP TABLE invoices;
            ALTER TABLE invoices_new RENAME TO invoices;
            CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
            """
        )
        conn.execute("PRAGMA foreign_keys=ON")
    finally:
        conn.close()


# ----------------------------- Users / sessions -----------------------------
def get_user_by_email(conn, email):
    return conn.execute(
        "SELECT * FROM users WHERE lower(email)=lower(?)", (email,)).fetchone()


def get_user(conn, user_id):
    return conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()


def all_users(conn):
    return conn.execute("SELECT * FROM users ORDER BY id").fetchall()


def create_user(conn, email, name, business_name, pw_hash, pw_salt):
    cur = conn.execute(
        "INSERT INTO users(email,name,business_name,pw_hash,pw_salt,created_at) "
        "VALUES(?,?,?,?,?,?)",
        (email, name, business_name, pw_hash, pw_salt, now_iso()),
    )
    return cur.lastrowid


def create_session(conn, token, user_id, staff_id=None):
    conn.execute(
        "INSERT INTO sessions(token,user_id,created_at,staff_id) VALUES(?,?,?,?)",
        (token, user_id, now_iso(), staff_id))


def user_for_session(conn, token):
    if not token:
        return None
    # Returns the OWNER's user row (data scoping is by user_id) plus, for an
    # attendant session, that staff member's id/shop/name so the app can lock
    # them to their shop and restricted UI.
    row = conn.execute(
        "SELECT u.*, se.staff_id AS staff_id, st.shop_id AS staff_shop_id, "
        "       st.name AS staff_name "
        "FROM sessions se JOIN users u ON u.id=se.user_id "
        "LEFT JOIN staff st ON st.id=se.staff_id WHERE se.token=?",
        (token,)).fetchone()
    return row


# ---- shop attendants (staff) ----
def create_staff(conn, owner_id, shop_id, name, username, pw_hash, pw_salt):
    cur = conn.execute(
        "INSERT INTO staff(owner_id,shop_id,name,username,pw_hash,pw_salt,created_at) "
        "VALUES(?,?,?,?,?,?,?)",
        (owner_id, shop_id, name, username, pw_hash, pw_salt, now_iso()))
    return cur.lastrowid


def get_staff_by_username(conn, username):
    return conn.execute("SELECT * FROM staff WHERE username=?", (username,)).fetchone()


def list_staff(conn, owner_id):
    return conn.execute(
        "SELECT s.id, s.name, s.username, s.shop_id, sh.name AS shop_name, s.created_at "
        "FROM staff s LEFT JOIN shops sh ON sh.id=s.shop_id "
        "WHERE s.owner_id=? ORDER BY s.id", (owner_id,)).fetchall()


def delete_staff(conn, staff_id, owner_id):
    conn.execute("DELETE FROM sessions WHERE staff_id=?", (staff_id,))  # log them out
    cur = conn.execute("DELETE FROM staff WHERE id=? AND owner_id=?", (staff_id, owner_id))
    return cur.rowcount


def update_staff(conn, staff_id, owner_id, shop_id, name=None):
    """Reassign an attendant to a shop (and optionally rename). Takes effect on
    their next request — user_for_session reads staff.shop_id live."""
    if name is not None:
        cur = conn.execute("UPDATE staff SET shop_id=?, name=? WHERE id=? AND owner_id=?",
                           (shop_id, name, staff_id, owner_id))
    else:
        cur = conn.execute("UPDATE staff SET shop_id=? WHERE id=? AND owner_id=?",
                           (shop_id, staff_id, owner_id))
    return cur.rowcount


def delete_session(conn, token):
    if token:
        conn.execute("DELETE FROM sessions WHERE token=?", (token,))


def has_users(conn):
    return conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None


def has_legacy_data(conn):
    """True if any pre-accounts business rows exist (user_id IS NULL) — i.e. this
    is a real upgrade from the single-tenant version, not a fresh install."""
    for t in USER_SCOPED_TABLES:
        if conn.execute(f"SELECT 1 FROM {t} WHERE user_id IS NULL LIMIT 1").fetchone():
            return True
    return False


def claim_legacy_data(conn, user_id):
    """Assign pre-accounts data (rows with NULL user_id) + the old global
    settings to the first user that registers, so nothing is lost on upgrade."""
    for t in USER_SCOPED_TABLES:
        conn.execute(f"UPDATE {t} SET user_id=? WHERE user_id IS NULL", (user_id,))
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    for r in rows:
        conn.execute(
            "INSERT OR IGNORE INTO user_settings(user_id,key,value) VALUES(?,?,?)",
            (user_id, r["key"], r["value"]))


# ----------------------------- Shops (per-user) -----------------------------
def create_shop(conn, user_id, name):
    """Create a shop for a user. If it's their first, make it the active shop."""
    name = (name or "My Shop").strip() or "My Shop"
    shop_id = conn.execute(
        "INSERT INTO shops(user_id,name,created_at) VALUES(?,?,?)",
        (user_id, name, now_iso())).lastrowid
    conn.execute(
        "UPDATE users SET active_shop_id=? WHERE id=? AND active_shop_id IS NULL",
        (shop_id, user_id))
    return shop_id


def list_shops(conn, user_id):
    return [dict(r) for r in conn.execute(
        "SELECT id, name, created_at FROM shops WHERE user_id=? ORDER BY id",
        (user_id,)).fetchall()]


def get_shop(conn, shop_id, user_id):
    return conn.execute(
        "SELECT id, name FROM shops WHERE id=? AND user_id=?", (shop_id, user_id)).fetchone()


def rename_shop(conn, shop_id, user_id, name):
    conn.execute("UPDATE shops SET name=? WHERE id=? AND user_id=?",
                 ((name or "").strip() or "My Shop", shop_id, user_id))


def shop_count(conn, user_id):
    return conn.execute(
        "SELECT COUNT(*) c FROM shops WHERE user_id=?", (user_id,)).fetchone()["c"]


def default_shop_id(conn, user_id):
    row = conn.execute(
        "SELECT id FROM shops WHERE user_id=? ORDER BY id LIMIT 1", (user_id,)).fetchone()
    return row["id"] if row else None


def set_active_shop(conn, user_id, shop_id):
    """shop_id 0 = the All-shops overview; otherwise it must belong to the user."""
    if shop_id and shop_id != 0 and not get_shop(conn, shop_id, user_id):
        return False
    conn.execute("UPDATE users SET active_shop_id=? WHERE id=?", (shop_id, user_id))
    return True


def stamp_user_shop(conn, user_id, shop_id):
    """Assign a user's still-unassigned rows to a shop (used after legacy claim)."""
    for t in USER_SCOPED_TABLES:
        conn.execute(
            f"UPDATE {t} SET shop_id=? WHERE user_id=? AND (shop_id IS NULL OR shop_id=0)",
            (shop_id, user_id))


# ----------------------------- Settings (per-user) --------------------------
def seed_user_settings(conn, user_id, overrides=None):
    data = dict(DEFAULT_SETTINGS)
    if overrides:
        data.update({k: v for k, v in overrides.items() if v})
    for k, v in data.items():
        conn.execute(
            "INSERT OR IGNORE INTO user_settings(user_id,key,value) VALUES(?,?,?)",
            (user_id, k, str(v)))


def get_settings(user_id):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT key, value FROM user_settings WHERE user_id=?", (user_id,)).fetchall()
    out = dict(DEFAULT_SETTINGS)
    out.update({r["key"]: r["value"] for r in rows})
    return out


def update_settings(user_id, data: dict):
    with get_conn() as conn:
        for k, v in data.items():
            conn.execute(
                "INSERT INTO user_settings(user_id,key,value) VALUES(?,?,?) "
                "ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value",
                (user_id, k, str(v)),
            )
    return get_settings(user_id)


def row_to_dict(row):
    return dict(row) if row is not None else None


def rows_to_list(rows):
    return [dict(r) for r in rows]
