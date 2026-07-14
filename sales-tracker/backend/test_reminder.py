"""Runnable check for the overdue-nudge logic: overdue detection (past due +
balance owed), and the once-a-day de-dupe. Run: python test_reminder.py"""
import os, tempfile
os.environ["SALESPAL_DB"] = tempfile.mkstemp(suffix=".db")[1]

import db; db.init_db()
import main

TODAY = main.today()
PAST = "2000-01-01"
FUTURE = "2999-01-01"


def _mk(conn, uid, due, total, paid):
    cur = conn.execute(
        "INSERT INTO invoices(user_id,invoice_no,date,due_date,status,total,created_at) "
        "VALUES(?,?,?,?,'unpaid',?,?)", (uid, "INV", TODAY, due, total, TODAY))
    iid = cur.lastrowid
    if paid:
        conn.execute("INSERT INTO payments(invoice_id,amount,method,date) VALUES(?,?,?,?)",
                     (iid, paid, "cash", TODAY))
    return iid


with db.get_conn() as conn:
    _mk(conn, 1, PAST, 1000, 0)      # overdue, fully owed
    _mk(conn, 1, PAST, 1000, 400)    # overdue, 600 still owed
    _mk(conn, 1, PAST, 1000, 1000)   # past due but paid -> not overdue
    _mk(conn, 1, FUTURE, 5000, 0)    # owed but not due yet -> not overdue
    _mk(conn, 1, None, 2000, 0)      # no due date -> not overdue
    n, owed = main._overdue_summary(conn, 1)

assert n == 2, n
assert abs(owed - 1600) < 0.01, owed

# de-dupe: first ping stamps today's date; second same-day is a no-op.
def _last(uid):
    with db.get_conn() as conn:
        r = conn.execute("SELECT value FROM settings WHERE key=?", (f"overdue_ping:{uid}",)).fetchone()
    return r["value"] if r else None

assert _last(1) is None
main._reminder_ping(1)               # no push_subs -> notify is a silent no-op, but stamp is set
assert _last(1) == TODAY
# force yesterday, confirm a new day re-stamps
with db.get_conn() as conn:
    conn.execute("UPDATE settings SET value='2000-01-01' WHERE key='overdue_ping:1'")
main._reminder_ping(1)
assert _last(1) == TODAY

# a user with no overdue invoices still gets stamped (so we don't recount hourly)
main._reminder_ping(2)
assert _last(2) == TODAY

print("ok")
