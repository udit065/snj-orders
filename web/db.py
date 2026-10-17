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
    master_id TEXT, alter_id TEXT
);
CREATE TABLE IF NOT EXISTS order_lines (
    order_guid TEXT NOT NULL, idx INTEGER, item TEXT, qty REAL, unit TEXT, rate REAL,
    amount REAL, due_date TEXT, godown TEXT, order_no TEXT
);
CREATE INDEX IF NOT EXISTS order_lines_guid ON order_lines(order_guid);
CREATE TABLE IF NOT EXISTS fulfilments (
    kind TEXT, party TEXT, order_no TEXT, item TEXT, qty REAL, date TEXT, voucher TEXT
);
CREATE INDEX IF NOT EXISTS fulfilments_key ON fulfilments(kind, party, order_no, item);
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


def replace_all(orders, fulfilments, synced_at):
    """Swap in a fresh snapshot from Tally in one transaction."""
    with connect() as c:
        c.execute("DELETE FROM orders")
        c.execute("DELETE FROM order_lines")
        c.execute("DELETE FROM fulfilments")
        for o in orders:
            c.execute(
                "INSERT OR REPLACE INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (o["guid"], o["kind"], o["number"], o["date"], o["party"], o["voucher_type"],
                 o.get("reference", ""), o.get("narration", ""), o.get("total", 0),
                 int(o.get("optional", False)), o.get("master_id", ""), o.get("alter_id", "")),
            )
            c.executemany(
                "INSERT INTO order_lines VALUES (?,?,?,?,?,?,?,?,?,?)",
                [(o["guid"], i, l["item"], l["qty"], l["unit"], l["rate"], l["amount"],
                  l.get("due_date", ""), l.get("godown", ""), l.get("order_no") or o["number"])
                 for i, l in enumerate(o["lines"])],
            )
        c.executemany(
            "INSERT INTO fulfilments VALUES (?,?,?,?,?,?,?)",
            [(f["kind"], f["party"], f["order_no"], f["item"], f["qty"], f["date"], f["voucher"])
             for f in fulfilments],
        )
        c.execute("INSERT OR REPLACE INTO meta VALUES ('synced_at', ?)", (synced_at,))


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
