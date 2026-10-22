import json
import os
import sys
import threading
from http.server import HTTPServer

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "bridge"), os.path.join(ROOT, "web"), os.path.dirname(os.path.abspath(__file__))]

import fake_tally  # noqa: E402


@pytest.fixture()
def tally_url():
    fake_tally.REQUESTS.clear()
    fake_tally.REJECT_RICH = False
    srv = HTTPServer(("127.0.0.1", 0), fake_tally.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ORDERS_DB", str(tmp_path / "t.db"))
    monkeypatch.setenv("BRIDGE_TOKEN", "secret-token")
    for m in ("db", "app"):
        sys.modules.pop(m, None)
    import app as webapp
    import db
    db.set_user("ramesh", "Ramesh Kumar", "password123")
    from fastapi.testclient import TestClient
    return TestClient(webapp.app)


def read(tally_url):
    import bridge
    cfg = {"tally_url": tally_url, "company": "SN JAIN INDUSTRIES PVT LTD - (26-27)", "timeout": 30,
           "days_back": 1500, "days_ahead": 400, "chunk_days": 60}
    return bridge.read_tally(cfg)


def test_bridge_reads_orders_by_size_and_only_exports(tally_url):
    orders, fulfilments = read(tally_url)
    by_no = {o["number"]: o for o in orders}
    assert sorted(by_no) == ["PO/0077", "SO/26-27/0412", "SO/26-27/0420"]  # cancelled one skipped, no repeats
    so = by_no["SO/26-27/0412"]
    assert so["kind"] == "sales" and so["voucher_type"] == "SNJ Order"  # custom type resolved to Sales Order
    assert so["narration"] == "Urgent before Diwali"
    assert so["total"] == 21600.0
    assert [(l["item"], l["size"], l["qty"], l["unit"]) for l in so["lines"]] == [
        ("001 SPORT BRA (28X40)-(Doz)", "32", 3.0, "Doz"),
        ("001 SPORT BRA (28X40)-(Doz)", "34", 3.0, "Doz"),
        ("NIKER S-XL-(Doz)", "36", 6.0, "Box"),
    ]
    assert [l["due_date"] for l in so["lines"]] == ["2026-10-20", "2026-10-20", "2026-10-01"]  # "8 Days" after 12 Oct
    assert so["lines"][2]["godown"] == "Main Location"
    po = by_no["PO/0077"]
    assert po["kind"] == "purchase" and po["total"] == 155000.0 and po["lines"][0]["size"] == ""
    assert sorted((f["item"][:5], f["size"], f["qty"]) for f in fulfilments) == [
        ("001 S", "32", 3.0), ("001 S", "34", 1.0), ("Cotto", "", 500.0), ("NIKER", "36", 2.0)]
    assert all("<TALLYREQUEST>Export</TALLYREQUEST>" in r for r in fake_tally.REQUESTS)
    assert all("SN JAIN INDUSTRIES PVT LTD - (26-27)" in r for r in fake_tally.REQUESTS)


def test_bridge_falls_back_to_lean_fields(tally_url):
    fake_tally.REJECT_RICH = True
    orders, _ = read(tally_url)
    assert len(orders) == 3
    reqs = [r for r in fake_tally.REQUESTS if "SNJVouchers" in r]
    # Once the lean list has returned data, later weeks send one lean request each.
    last_rich = max(i for i, r in enumerate(reqs) if "Narration" in r)
    assert last_rich < len(reqs) - 2 and all("Narration" not in r for r in reqs[last_rich + 1:])


def test_empty_read_leaves_website_alone(tally_url, monkeypatch):
    import bridge
    monkeypatch.setattr(bridge, "read_tally", lambda cfg: ([], []))
    monkeypatch.setattr(bridge, "send", lambda *a: pytest.fail("must not send an empty snapshot"))
    bridge.sync_once({})


def test_website_shows_progress_by_size(tally_url, client):
    orders, fulfilments = read(tally_url)
    payload = {"synced_at": "2026-10-17T10:42:00+05:30", "orders": orders, "fulfilments": fulfilments}
    assert client.post("/api/sync", content=json.dumps(payload)).status_code == 401
    r = client.post("/api/sync", content=json.dumps(payload), headers={"Authorization": "Bearer secret-token"})
    assert r.json() == {"orders": 3, "fulfilments": 4}

    assert client.get("/orders/sales", follow_redirects=False).headers["location"] == "/login"
    assert "Wrong username" in client.post("/login", data={"username": "ramesh", "password": "nope"}).text
    client.post("/login", data={"username": "Ramesh", "password": "password123"})

    page = client.get("/orders/sales").text
    assert "Agarwal Hosiery" in page and "Mehta &amp; Sons" in page and "Partly done" in page
    assert "21,600.00" in page and "17 Oct, 10:42 AM" in page
    assert "Tirupur" not in page

    purchase_all = client.get("/orders/purchase?status=all").text
    assert "Completed" in purchase_all and "1,55,000.00" in purchase_all
    assert "PO/0077" not in client.get("/orders/purchase").text  # completed hidden by default

    assert "Mehta" in client.get("/orders/sales?q=niker xxl").text
    assert "Agarwal" not in client.get("/orders/sales?q=niker xxl").text

    detail = client.get("/order/g-so-1").text
    assert "GST Sales SNJ/26-27/2201" in detail and "Size 34" in detail
    # bra: size 32 fully sent, size 34 has 2 of 3 left; niker 36: 4 of 6 left
    import re
    cells = re.findall(r'data-l="Left" class="n ?(?:left)?">([\d.]+)<', detail)
    assert cells == ["2", "0", "2", "4", "4"]
