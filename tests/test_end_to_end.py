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
    import bridge
    import tally
    bridge._variants = list(tally.FETCH_VARIANTS)
    srv = HTTPServer(("127.0.0.1", 0), fake_tally.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ORDERS_DB", str(tmp_path / "t.db"))
    monkeypatch.setenv("BRIDGE_TOKEN", "secret-token")
    monkeypatch.setenv("STAFF_LOGINS", "sidharth:Long-Pass-1, short:abc")
    for m in ("db", "app"):
        sys.modules.pop(m, None)
    import app as webapp
    import db
    db.set_user("ramesh", "Ramesh Kumar", "password123")
    from fastapi.testclient import TestClient
    return TestClient(webapp.app)


import datetime as dt  # noqa: E402

CFG = {"company": "SN JAIN INDUSTRIES PVT LTD - (26-27)", "timeout": 30, "chunk_days": 7}


def read(tally_url, start=dt.date(2026, 9, 1), end=dt.date(2026, 11, 30)):
    import bridge
    return bridge.read_tally({**CFG, "tally_url": tally_url}, start, end)


def post_sync(client, start, end, full, tally_url, synced_at="2026-10-17T10:42:00+05:30"):
    orders, fulfilments = read(tally_url, start, end)
    payload = {"synced_at": synced_at, "full": full, "from": start.isoformat(), "to": end.isoformat(),
               "orders": orders, "fulfilments": fulfilments}
    return client.post("/api/sync", content=json.dumps(payload), headers={"Authorization": "Bearer secret-token"})


def test_bridge_reads_orders_by_size_and_only_exports(tally_url):
    orders, fulfilments = read(tally_url)
    by_no = {o["number"]: o for o in orders}
    assert sorted(by_no) == ["PO/0077", "SO/26-27/0412", "SO/26-27/0420", "SO/D5/123 R(CANCEL)"]  # no repeats
    assert by_no["SO/D5/123 R(CANCEL)"]["cancelled"] and not by_no["SO/26-27/0412"]["cancelled"]
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
    assert len(orders) == 4
    reqs = [r for r in fake_tally.REQUESTS if "SNJVouchers" in r]
    # Once the lean list has returned data, later weeks send one lean request each.
    last_rich = max(i for i, r in enumerate(reqs) if "Narration" in r)
    assert last_rich < len(reqs) - 2 and all("Narration" not in r for r in reqs[last_rich + 1:])


def test_website_shows_progress_by_size(tally_url, client):
    assert client.post("/api/sync", content="{}").status_code == 401
    r = post_sync(client, dt.date(2026, 9, 1), dt.date(2026, 11, 30), True, tally_url)
    assert r.json() == {"orders": 4, "fulfilments": 4, "has_full": True, "run": None}

    assert client.get("/orders/sales", follow_redirects=False).headers["location"] == "/login"
    assert "Wrong username" in client.post("/login", data={"username": "ramesh", "password": "nope"}).text
    client.post("/login", data={"username": "Ramesh", "password": "password123"})

    page = client.get("/orders/sales").text
    assert "Agarwal Hosiery" in page and "Mehta &amp; Sons" in page and "Partly done" in page
    assert "21,600.00" in page and "17 Oct, 10:42 AM" in page
    assert "Tirupur" not in page and "Dhanlaxmi" not in page  # cancelled hidden by default
    assert "Dhanlaxmi" in client.get("/orders/sales?status=cancelled").text

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


def test_quick_sync_replaces_only_recent_days(tally_url, client):
    post_sync(client, dt.date(2026, 9, 1), dt.date(2026, 11, 30), True, tally_url)
    client.post("/login", data={"username": "ramesh", "password": "password123"})
    # Pretend Tally no longer has the 15 Oct order: a quick sync of 14-16 Oct drops it,
    # and keeps everything outside that window, including the 12 Oct order's deliveries.
    fake_tally.REQUESTS.clear()
    import bridge
    real = bridge.read_tally
    def without_mehta(cfg, s, e):
        o, f = real(cfg, s, e)
        return [x for x in o if x["number"] != "SO/26-27/0420"], f
    bridge.read_tally = without_mehta
    try:
        r = post_sync(client, dt.date(2026, 10, 14), dt.date(2026, 10, 16), False, tally_url,
                      synced_at="2026-10-17T11:00:00+05:30")
    finally:
        bridge.read_tally = real
    assert r.json() == {"orders": 0, "fulfilments": 4, "has_full": True, "run": None}
    page = client.get("/orders/sales?status=all").text
    assert "Mehta" not in page and "Agarwal" in page and "11:00 AM" in page
    assert "GST Sales SNJ/26-27/2201" in client.get("/order/g-so-1").text


@pytest.fixture()
def site(tally_url, client, tmp_path, monkeypatch):
    """The bridge talking to the test website; returns its config and a log of what it sent."""
    import gzip
    import urllib.request

    real_urlopen = urllib.request.urlopen
    sent = []

    def via_test_client(req, timeout):
        if req.full_url.startswith(tally_url):
            return real_urlopen(req, timeout=timeout)
        assert req.get_header("Content-encoding") == "gzip"
        sent.append(json.loads(gzip.decompress(req.data)))
        r = client.post("/api/sync", content=req.data, headers=dict(req.header_items()))
        assert r.status_code == 200, r.text
        class Resp:
            def __enter__(self): return self
            def __exit__(self, *a): pass
            def read(self): return r.content
        return Resp()
    monkeypatch.setattr(urllib.request, "urlopen", via_test_client)
    cfg = {**CFG, "tally_url": tally_url, "website_url": "http://site", "token": "secret-token",
           "days_back": 400, "quick_days_back": 10, "days_ahead": 60, "full_sync_hour": 2,
           "state_file": str(tmp_path / "state.json")}
    client.post("/login", data={"username": "ramesh", "password": "password123"})
    return cfg, sent


def test_full_copy_goes_week_by_week_and_finishes(site, client):
    import bridge
    import db
    cfg, sent = site
    bridge.run_round(cfg)
    assert sent[0]["full"] is False and sent[1]["start_full"]  # quick sync first, then the full copy
    weeks = [m for m in sent if "orders" in m][1:]
    assert all((dt.date.fromisoformat(m["to"]) - dt.date.fromisoformat(m["from"])).days <= 6 for m in weeks)
    assert sent[-1]["complete"] and db.has_full()
    assert "Agarwal" in client.get("/orders/sales?status=all").text
    state = bridge.load_state(cfg)
    assert state["last_full"] == dt.date.today().isoformat() and "full" not in state

    # The next round only does the quick sync.
    sent.clear()
    bridge.run_round(cfg)
    assert len(sent) == 1 and sent[0]["from"] == (dt.date.today() - dt.timedelta(days=10)).isoformat()


def test_full_copy_carries_on_after_being_cut_off(site, client, monkeypatch):
    import bridge
    import db
    cfg, sent = site
    real, calls = bridge.read_chunk, []
    quick_weeks = len(list(bridge.chunks(cfg, *bridge.window(cfg, full=False))))

    def dies_after_some_weeks(*a):
        calls.append(a)
        if len(calls) == quick_weeks + 60:  # past the 12 Oct week
            raise ConnectionResetError("remote session closed")
        return real(*a)
    monkeypatch.setattr(bridge, "read_chunk", dies_after_some_weeks)
    with pytest.raises(ConnectionResetError):
        bridge.run_round(cfg)
    reached = bridge.load_state(cfg)["full"]["next"]
    assert not db.has_full() and "Agarwal" in client.get("/orders/sales?status=all").text  # saved so far

    calls.clear()
    monkeypatch.setattr(bridge, "read_chunk", lambda *a: calls.append(a) or real(*a))
    sent.clear()
    bridge.run_round(cfg)
    assert not any(m.get("start_full") for m in sent)  # carried on, didn't start over
    assert calls[quick_weeks][2].isoformat() == reached and sent[-1]["complete"] and db.has_full()


def test_full_copy_stops_after_its_time_and_restarts_if_site_forgets(site, client):
    import bridge
    import db
    cfg, sent = site
    bridge.run_round(cfg, minutes=0)  # only the quick sync and the start of the full copy
    full = bridge.load_state(cfg)["full"]
    assert full["next"] == full["from"] and not db.has_full()

    db.set_meta("full_run", "")  # the free host restarted and lost everything
    sent.clear()
    bridge.run_round(cfg)
    assert sent[1]["start_full"] and sent[1]["run"] != full["run"] and db.has_full()


def test_empty_quick_read_leaves_website_alone(site, client, monkeypatch):
    import bridge
    cfg, sent = site
    bridge.run_round(cfg)
    monkeypatch.setattr(bridge, "read_tally", lambda *a: ([], []))
    sent.clear()
    bridge.run_round(cfg)
    assert sent == [{"synced_at": sent[0]["synced_at"], "status_only": True}]
    assert "Agarwal" in client.get("/orders/sales?status=all").text


def test_staff_logins_from_environment(client):
    assert "Wrong" not in client.post("/login", data={"username": "sidharth", "password": "Long-Pass-1"}).text
    assert "Sidharth" in client.get("/orders/sales").text
    client.get("/logout")
    assert "Wrong" in client.post("/login", data={"username": "short", "password": "abc"}).text
