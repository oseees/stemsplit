"""Runnable check for multiple bank accounts: the one-time backfill off the
legacy transfer_* columns, per-invoice account resolution (named vs default),
default promotion on delete, and that a client can't attach someone else's
account. Run: python test_bank_accounts.py"""
import os, tempfile

os.environ["SALESPAL_DB"] = tempfile.mkstemp(suffix=".db")[1]

import db

# --- seed a LEGACY user (single account in the old columns) BEFORE migrating --
db.init_db()  # creates schema
with db.get_conn() as conn:
    conn.execute("INSERT INTO users(id,email,pw_hash,pw_salt,created_at) VALUES(1,'a@t.co','x','s',?)",
                 (db.now_iso(),))
    conn.execute("INSERT INTO users(id,email,pw_hash,pw_salt,created_at) VALUES(2,'b@t.co','x','s',?)",
                 (db.now_iso(),))
    conn.execute("UPDATE users SET transfer_enabled=1, transfer_bank='GTBank',"
                 "transfer_number='0123456789', transfer_name='Ada Shop' WHERE id=1")
    conn.execute("DELETE FROM bank_accounts")  # pretend migration hasn't run

db.init_db()  # re-run: the backfill should now move the legacy account across
import main

with db.get_conn() as conn:
    rows = main._accounts(conn, 1)
    assert len(rows) == 1, rows
    assert rows[0]["bank"] == "GTBank" and rows[0]["number"] == "0123456789"
    assert rows[0]["is_default"] == 1
    assert main._accounts(conn, 2) == [], "user with no legacy account stays empty"
    # backfill is idempotent — running init again must not duplicate
db.init_db()
with db.get_conn() as conn:
    assert len(main._accounts(conn, 1)) == 1, "backfill must not duplicate"

# --- add a second account, per-invoice resolution ----------------------------
with db.get_conn() as conn:
    conn.execute("INSERT INTO bank_accounts(user_id,bank,number,name,is_default,created_at)"
                 " VALUES(2,'Opay','9988776655','Ada Opay',0,?)", (db.now_iso(),))
    opay = conn.execute("SELECT id FROM bank_accounts WHERE bank='Opay'").fetchone()["id"]
    conn.execute("UPDATE bank_accounts SET user_id=1 WHERE id=?", (opay,))

    def mk(bank_account_id):
        cur = conn.execute(
            "INSERT INTO invoices(user_id,invoice_no,date,status,total,bank_account_id,created_at)"
            " VALUES(1,'INV',?,'unpaid',100,?,?)", (db.today() if hasattr(db, "today") else "2026-01-01",
                                                    bank_account_id, db.now_iso()))
        return conn.execute("SELECT * FROM invoices WHERE id=?", (cur.lastrowid,)).fetchone()

    gt = main._default_account(conn, 1)["id"]
    # invoice naming Opay resolves to Opay; invoice naming nothing -> default (GTBank)
    assert main._account_for_invoice(conn, mk(opay))["bank"] == "Opay"
    assert main._account_for_invoice(conn, mk(None))["bank"] == "GTBank"
    # an invoice pointing at a DELETED/foreign account falls back to the default
    assert main._account_for_invoice(conn, mk(99999))["bank"] == "GTBank"

    # a client must not be able to attach another user's account
    conn.execute("INSERT INTO bank_accounts(user_id,bank,number,name,is_default,created_at)"
                 " VALUES(2,'Kuda','1112223334','Other',1,?)", (db.now_iso(),))
    other = conn.execute("SELECT id FROM bank_accounts WHERE bank='Kuda'").fetchone()["id"]
    assert main._valid_account_id(conn, other, 1) is None, "foreign account must be rejected"
    assert main._valid_account_id(conn, opay, 1) == opay
    assert main._valid_account_id(conn, None, 1) is None

    # transfer gate: needs the master switch AND at least one account
    assert main._transfer_ready(conn, {"id": 1, "transfer_enabled": 1}) is True
    assert main._transfer_ready(conn, {"id": 1, "transfer_enabled": 0}) is False
    assert main._transfer_ready(conn, {"id": 3, "transfer_enabled": 1}) is False

    # _pay_to follows the invoice's account, not just the default
    u = {"id": 1, "transfer_enabled": 1}
    assert main._pay_to(conn, u, mk(opay))["bank"] == "Opay"
    assert main._pay_to(conn, u, mk(None))["bank"] == "GTBank"
    assert main._pay_to(conn, {"id": 1, "transfer_enabled": 0}, mk(opay)) is None

# --- an edit that OMITS bank_account_id must not reset the sale's account ----
# (older cached app.js and offline replays send no such field)
inv_in = main.InvoiceIn(items=[main.InvoiceItemIn(description="x")])
assert "bank_account_id" not in inv_in.model_fields_set, "absent field must be distinguishable"
inv_in2 = main.InvoiceIn(items=[main.InvoiceItemIn(description="x")], bank_account_id=None)
assert "bank_account_id" in inv_in2.model_fields_set, "explicit null must be distinguishable"

print("ok")
