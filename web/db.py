import hashlib
import hmac
import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.environ.get("ORDERS_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "orders.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
    guid TEXT PRIMARY KEY, kind TEXT NOT NULL, number TEXT, date TEXT, party TEXT,
    voucher_type TEXT, reference TEXT, narration TEXT, total REAL, optional INTEGER,
    master_id TEXT, alter_id TEXT, cancelled INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS orders_date ON orders(date);
CREATE TABLE IF NOT EXISTS order_lines (
    order_guid TEXT NOT NULL, idx INTEGER, item TEXT, size TEXT, qty REAL, unit TEXT, rate REAL,
    amount REAL, due_date TEXT, godown TEXT, order_no TEXT
);
CREATE INDEX IF NOT EXISTS order_lines_guid ON order_lines(order_guid);
CREATE TABLE IF NOT EXISTS fulfilments (
    kind TEXT, party TEXT, order_no TEXT, item TEXT, size TEXT, qty REAL, date TEXT, voucher TEXT
);
CREATE INDEX IF NOT EXISTS fulfilments_key ON fulfilments(kind, party, order_no, item, size);
CREATE INDEX IF NOT EXISTS fulfilments_date ON fulfilments(date);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY, name TEXT, pw_hash TEXT NOT NULL, active INTEGER DEFAULT 1
);
"""


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init():
    with connect() as c:
        c.executescript(SCHEMA)


def replace_all(orders, fulfilments, synced_at, date_from=None, date_to=None):
    """Swap in a fresh copy from Tally in one transaction.

    With dates, only that period is replaced (a quick sync); everything is replaced otherwise.
    """
    with connect() as c:
        if date_from:
            c.execute("DELETE FROM order_lines WHERE order_guid IN "
                      "(SELECT guid FROM orders WHERE date BETWEEN ? AND ?)", (date_from, date_to))
            c.execute("DELETE FROM orders WHERE date BETWEEN ? AND ?", (date_from, date_to))
            c.execute("DELETE FROM fulfilments WHERE date BETWEEN ? AND ?", (date_from, date_to))
        else:
            c.execute("DELETE FROM orders")
            c.execute("DELETE FROM order_lines")
            c.execute("DELETE FROM fulfilments")
        for o in orders:
            # An order whose date was moved into this period replaces its old copy.
            c.execute("DELETE FROM order_lines WHERE order_guid=?", (o["guid"],))
            c.execute(
                "INSERT OR REPLACE INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (o["guid"], o["kind"], o["number"], o["date"], o["party"], o["voucher_type"],
                 o.get("reference", ""), o.get("narration", ""), o.get("total", 0),
                 int(o.get("optional", False)), o.get("master_id", ""), o.get("alter_id", ""),
                 int(o.get("cancelled", False))),
            )
            c.executemany(
                "INSERT INTO order_lines VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                [(o["guid"], i, l["item"], l.get("size", ""), l["qty"], l["unit"], l["rate"], l["amount"],
                  l.get("due_date", ""), l.get("godown", ""), l.get("order_no") or o["number"])
                 for i, l in enumerate(o["lines"])],
            )
        c.executemany(
            "INSERT INTO fulfilments VALUES (?,?,?,?,?,?,?,?)",
            [(f["kind"], f["party"], f["order_no"], f["item"], f.get("size", ""), f["qty"], f["date"], f["voucher"])
             for f in fulfilments],
        )
        c.execute("INSERT OR REPLACE INTO meta VALUES ('synced_at', ?)", (synced_at,))
        if not date_from:
            c.execute("INSERT OR REPLACE INTO meta VALUES ('full_synced_at', ?)", (synced_at,))


def has_full():
    with connect() as c:
        return c.execute("SELECT 1 FROM meta WHERE key='full_synced_at'").fetchone() is not None


def last_synced():
    with connect() as c:
        row = c.execute("SELECT value FROM meta WHERE key='synced_at'").fetchone()
    return row["value"] if row else None


# --- staff logins -----------------------------------------------------------

def hash_password(password, salt=None):
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return salt.hex() + "$" + digest.hex()


def check_password(password, stored):
    salt_hex, _ = stored.split("$", 1)
    return hmac.compare_digest(hash_password(password, bytes.fromhex(salt_hex)), stored)


def set_user(username, name, password):
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO users (username, name, pw_hash, active) VALUES (?,?,?,1)",
                  (username.lower(), name, hash_password(password)))


def authenticate(username, password):
    with connect() as c:
        row = c.execute("SELECT * FROM users WHERE username=? AND active=1",
                        (username.lower().strip(),)).fetchone()
    if row and check_password(password, row["pw_hash"]):
        return dict(row)
    return None
