"""SNJ Orders website (view only): sales and purchase orders copied from Tally."""

import hmac
import os
import secrets
from collections import defaultdict
from datetime import date, datetime

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

import db

HERE = os.path.dirname(os.path.abspath(__file__))
BRIDGE_TOKEN = os.environ.get("BRIDGE_TOKEN", "")
SECRET_KEY = os.environ.get("SECRET_KEY") or secrets.token_hex(32)

app = FastAPI(title="SNJ Orders", docs_url=None, redoc_url=None)
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, https_only=os.environ.get("HTTPS_ONLY") == "1",
                   max_age=12 * 3600)
app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(HERE, "templates"))
db.init()


def inr(value):
    """Indian digit grouping: 482560.5 -> 4,82,560.50"""
    neg, value = value < 0, abs(value or 0)
    whole, frac = f"{value:.2f}".split(".")
    head, tail = whole[:-3], whole[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    out = ",".join(groups + [tail]) if groups else tail
    return ("-" if neg else "") + out + "." + frac


def qty(value):
    return f"{value:g}"


def nice_date(s):
    try:
        return datetime.strptime(s, "%Y-%m-%d").strftime("%d %b %Y")
    except (TypeError, ValueError):
        return s or ""


def nice_time(s):
    try:
        return datetime.fromisoformat(s).strftime("%d %b, %I:%M %p")
    except (TypeError, ValueError):
        return s or "never"


templates.env.filters.update(inr=inr, qty=qty, nice_date=nice_date)


def render(request, name, **ctx):
    ctx.update(user=request.session.get("user"), synced_at=nice_time(db.last_synced()))
    return templates.TemplateResponse(request, name, ctx)


def require_login(request):
    if not request.session.get("user"):
        raise HTTPException(status_code=303, headers={"Location": "/login"})


# --- order maths -----------------------------------------------------------

def with_progress(conn, guids):
    """For each order, attach its lines with ordered / delivered / pending quantities."""
    if not guids:
        return {}
    marks = ",".join("?" * len(guids))
    lines = conn.execute(
        f"SELECT l.*, o.kind, o.party FROM order_lines l JOIN orders o ON o.guid = l.order_guid "
        f"WHERE l.order_guid IN ({marks}) ORDER BY l.order_guid, l.idx", guids).fetchall()
    delivered = defaultdict(float)
    for r in conn.execute("SELECT kind, party, order_no, item, size, SUM(qty) FROM fulfilments "
                          "GROUP BY kind, party, order_no, item, size"):
        delivered[tuple(r[:5])] = r[5]
    out = defaultdict(list)
    for l in lines:
        k = (l["kind"], l["party"], l["order_no"], l["item"], l["size"])
        sent = max(0.0, min(l["qty"], delivered[k]))  # same item and size twice: fill lines in turn
        delivered[k] -= sent
        out[l["order_guid"]].append({**dict(l), "sent": sent, "left": round(l["qty"] - sent, 4)})
    return out


def status_of(lines):
    ordered = sum(l["qty"] for l in lines)
    sent = sum(l["sent"] for l in lines)
    if ordered and sent >= ordered - 1e-9:
        return "done"
    return "partly" if sent > 0 else "pending"


STATUS_LABEL = {"pending": "Pending", "partly": "Partly done", "done": "Completed"}


# --- pages -------------------------------------------------------------------

@app.get("/login")
def login_page(request: Request):
    return render(request, "login.html", error=None)


@app.post("/login")
def login(request: Request, username: str = Form(...), password: str = Form(...)):
    user = db.authenticate(username, password)
    if not user:
        return render(request, "login.html", error="Wrong username or password.")
    request.session["user"] = {"username": user["username"], "name": user["name"] or user["username"]}
    return RedirectResponse("/", status_code=303)


@app.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


@app.get("/")
def home():
    return RedirectResponse("/orders/sales", status_code=303)


@app.get("/orders/{kind}")
def order_list(request: Request, kind: str, q: str = "", status: str = "open",
               date_from: str = "", date_to: str = ""):
    require_login(request)
    if kind not in ("sales", "purchase"):
        raise HTTPException(404)
    sql, args = "SELECT * FROM orders WHERE kind=?", [kind]
    for word in q.split():  # every word must appear somewhere: "niker 38" finds "NIKER S-XL - 38"
        like = f"%{word}%"
        sql += (" AND (party LIKE ? OR number LIKE ? OR reference LIKE ? OR guid IN "
                "(SELECT order_guid FROM order_lines WHERE item LIKE ?))")
        args += [like] * 4
    if date_from:
        sql += " AND date >= ?"
        args.append(date_from)
    if date_to:
        sql += " AND date <= ?"
        args.append(date_to)
    sql += " ORDER BY date DESC, number DESC"
    with db.connect() as c:
        orders = [dict(o) for o in c.execute(sql, args).fetchall()]
        progress = with_progress(c, [o["guid"] for o in orders])
    rows, counts = [], {"pending": 0, "partly": 0, "done": 0}
    today = date.today().isoformat()
    for o in orders:
        lines = progress.get(o["guid"], [])
        o["status"] = status_of(lines)
        counts[o["status"]] += 1
        o["status_label"] = STATUS_LABEL[o["status"]]
        o["items"] = len({l["item"] for l in lines})
        dues = [l["due_date"] for l in lines if l["due_date"] and l["left"] > 0]
        o["next_due"] = min(dues) if dues else ""
        o["overdue"] = bool(o["next_due"] and o["next_due"] < today)
        if status == "all" or (status == "open" and o["status"] != "done") or status == o["status"]:
            rows.append(o)
    return render(request, "orders.html", kind=kind, orders=rows, counts=counts, q=q, status=status,
                  date_from=date_from, date_to=date_to)


@app.get("/order/{guid}")
def order_detail(request: Request, guid: str):
    require_login(request)
    with db.connect() as c:
        order = c.execute("SELECT * FROM orders WHERE guid=?", (guid,)).fetchone()
        if not order:
            raise HTTPException(404, "This order is no longer in Tally, or is older than the sync window.")
        order = dict(order)
        lines = with_progress(c, [guid]).get(guid, [])
        order_nos = sorted({l["order_no"] for l in lines})
        marks = ",".join("?" * len(order_nos)) or "''"
        history = c.execute(
            f"SELECT * FROM fulfilments WHERE kind=? AND party=? AND order_no IN ({marks}) "
            "ORDER BY date, voucher, item, size",
            [order["kind"], order["party"], *order_nos]).fetchall()
    order["status"] = status_of(lines)
    order["status_label"] = STATUS_LABEL[order["status"]]
    return render(request, "order.html", order=order, items=group_by_item(lines), history=history)


def group_by_item(lines):
    """Sizes of the same item sit together under one heading, with item totals."""
    items = {}
    for l in lines:
        g = items.setdefault(l["item"], {"item": l["item"], "unit": l["unit"], "rate": l["rate"],
                                         "qty": 0.0, "sent": 0.0, "left": 0.0, "amount": 0.0, "sizes": []})
        for k in ("qty", "sent", "left", "amount"):
            g[k] = round(g[k] + l[k], 4)
        g["sizes"].append(l)
    return list(items.values())


# --- bridge endpoint -----------------------------------------------------------

@app.post("/api/sync")
async def sync(request: Request):
    auth = request.headers.get("authorization", "")
    if not BRIDGE_TOKEN or not hmac.compare_digest(auth, f"Bearer {BRIDGE_TOKEN}"):
        raise HTTPException(401, "Bad bridge token")
    data = await request.json()
    db.replace_all(data["orders"], data["fulfilments"], data["synced_at"])
    return {"orders": len(data["orders"]), "fulfilments": len(data["fulfilments"])}


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    if exc.status_code == 303:
        return RedirectResponse(exc.headers["Location"], status_code=303)
    if request.url.path.startswith("/api/"):
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    return render(request, "error.html", message=exc.detail if exc.status_code != 404 or exc.detail != "Not Found"
                  else "Page not found.")
