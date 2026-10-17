import os
import sys
import threading
from http.server import HTTPServer

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "bridge"), os.path.join(ROOT, "web"), os.path.dirname(os.path.abspath(__file__))]


@pytest.fixture()
def tally_url():
    import fake_tally
    fake_tally.REQUESTS.clear()
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
    cfg = {"tally_url": tally_url, "company": "SN Jain Industries", "days_back": 365}
    return bridge.read_tally(cfg)


def test_bridge_reads_orders_and_only_exports(tally_url):
    import fake_tally
    orders, fulfilments = read(tally_url)
    by_no = {o["number"]: o for o in orders}
    assert set(by_no) == {"SO/26-27/0412", "SO/26-27/0420", "PO/0077"}  # cancelled one skipped
    so = by_no["SO/26-27/0412"]
    assert so["kind"] == "sales" and so["voucher_type"] == "SNJ Order"  # custom type resolved to Sales Order
    assert so["narration"] == "Urgent before Diwali"
    assert so["total"] == 21600.0
    assert so["lines"][0] == {"item": "001 SPORT BRA - 32", "qty": 6.0, "unit": "Doz", "rate": 1200.0,
                              "amount": 7200.0, "due_date": "2026-10-20", "godown": "Main Location",
                              "order_no": "SO/26-27/0412"}
    assert so["lines"][1]["unit"] == "Box"
    assert by_no["PO/0077"]["kind"] == "purchase" and by_no["PO/0077"]["total"] == 155000.0
    assert len(fulfilments) == 3
    assert all("<TALLYREQUEST>Export</TALLYREQUEST>" in r for r in fake_tally.REQUESTS)
    assert all("SN Jain Industries" in r for r in fake_tally.REQUESTS)


def test_website_shows_progress(tally_url, client):
    import json
    orders, fulfilments = read(tally_url)
    payload = {"synced_at": "2026-10-17T10:42:00+05:30", "orders": orders, "fulfilments": fulfilments}
    assert client.post("/api/sync", content=json.dumps(payload)).status_code == 401
    r = client.post("/api/sync", content=json.dumps(payload), headers={"Authorization": "Bearer secret-token"})
    assert r.json() == {"orders": 3, "fulfilments": 3}

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

    assert "Mehta" in client.get("/orders/sales?q=niker 38").text
    assert "Agarwal" not in client.get("/orders/sales?q=niker 38").text

    detail = client.get("/order/g-so-1").text
    assert "GST Sales SNJ/26-27/2201" in detail
    assert ">2</td>" in detail and ">4</td>" in detail  # bra: 4 sent 2 left; niker: 2 sent 4 left
    assert "Page not found" in client.get("/nope").text or client.get("/nope").status_code == 404
