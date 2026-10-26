"""The accounts part of the bridge: balances, open bills and vouchers, read only."""
import datetime as dt
import os
import sys
import threading
from http.server import HTTPServer

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "bridge"), os.path.dirname(os.path.abspath(__file__))]

import accounts  # noqa: E402
import bridge  # noqa: E402
import fake_tally  # noqa: E402
import tally  # noqa: E402


@pytest.fixture()
def cfg(tmp_path):
    fake_tally.REQUESTS.clear()
    bridge._acct_variants = list(accounts.FETCH_VARIANTS)
    srv = HTTPServer(("127.0.0.1", 0), fake_tally.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield {"tally_url": f"http://127.0.0.1:{srv.server_port}", "company": "SN JAIN INDUSTRIES PVT LTD - (26-27)",
           "timeout": 30, "days_per_request": 31, "quick_days_back": 10, "accounts_every_minutes": 30,
           "accounts_from": "2026-10-01", "full_sync_hour": 0, "state_file": str(tmp_path / "state.json")}
    srv.shutdown()


def test_balances_and_open_bills(cfg):
    parties = {p["name"]: p for p in bridge.read_balances(cfg)}
    assert sorted(parties) == ["Agarwal Hosiery", "Gupta Traders", "Mehta & Sons"]  # Sundry Debtors only
    a = parties["Agarwal Hosiery"]
    assert (a["opening"], a["closing"], a["credit_limit"], a["credit_days"]) == (12000.0, 14040.0, 50000.0, 30)
    assert parties["Mehta & Sons"]["closing"] == -500.0  # in credit: SNJ owes them
    bills = bridge.read_bills(cfg)
    assert [(b["party"], b["ref"], b["date"], b["due_date"], b["amount"]) for b in bills] == [
        ("Agarwal Hosiery", "OPN/77", "2026-04-01", "2026-05-01", 12000.0),
        ("Agarwal Hosiery", "SNJ/26-27/2201", "2026-10-14", "2026-11-13", 2040.0),
        ("Mehta & Sons", "", "2026-10-21", "2026-10-21", -500.0),
    ]


def test_account_vouchers(cfg):
    types = bridge.account_types(bridge.voucher_types(cfg))
    entries = bridge.read_account_chunk(cfg, types, {"Agarwal Hosiery", "Mehta & Sons"},
                                        dt.date(2026, 10, 1), dt.date(2026, 10, 31))
    by = {e["number"]: e for e in entries}
    assert sorted(by) == ["J/9", "R/118", "SNJ/26-27/2201"]  # cancelled receipt and supplier payment left out
    inv = by["SNJ/26-27/2201"]
    assert (inv["base"], inv["party"], inv["amount"]) == ("Sales", "Agarwal Hosiery", 5040.0)
    assert inv["bills"] == [{"ref": "SNJ/26-27/2201", "type": "New Ref", "amount": 5040.0, "credit_days": 30}]
    assert inv["ship"]["lr_no"] == "LR 552190" and inv["ship"]["lr_date"] == "2026-10-15"
    assert [(l["size"], l["qty"]) for l in inv["lines"]] == [("32", 3.0), ("34", 1.0)]
    rc = by["R/118"]
    assert (rc["base"], rc["amount"], rc["narration"]) == ("Receipt", -3000.0, "NEFT UTIB0000123456")
    assert rc["bills"][0]["type"] == "Agst Ref" and rc["lines"] == [] and rc["ship"] is None
    assert by["J/9"]["party"] == "Mehta & Sons" and by["J/9"]["amount"] == -500.0
    assert all("<TALLYREQUEST>Export</TALLYREQUEST>" in r for r in fake_tally.REQUESTS)


def test_sync_sends_balances_recent_days_and_a_full_copy(cfg, monkeypatch):
    sent = []
    monkeypatch.setattr(bridge, "bridge_call", lambda c, path, body=None: sent.append((path, body)) or {"ok": True})
    monkeypatch.setattr(accounts.dt, "date", type("D", (dt.date,), {"today": classmethod(lambda c: dt.date(2026, 10, 26))}))
    monkeypatch.setattr(bridge.dt, "date", accounts.dt.date)
    state = {}
    bridge.sync_accounts(cfg, state, bridge.voucher_types(cfg), deadline=float("inf"))
    paths = [p for p, _ in sent]
    assert paths[0] == "balances" and sent[0][1]["bills_source"] == "tally" and len(sent[0][1]["bills"]) == 3
    quick = sent[1][1]
    assert (quick["from"], quick["to"], len(quick["entries"])) == ("2026-10-16", "2026-10-26", 2)
    fulls = [b for p, b in sent[2:] if p == "accounts"]
    assert fulls[0]["from"] == "2026-10-01"
    assert state["accounts"]["last_full"] == "2026-10-26" and "next" not in state["accounts"]
    # Within half an hour, the next round doesn't read balances again.
    sent.clear()
    bridge.sync_accounts(cfg, state, bridge.voucher_types(cfg), deadline=float("inf"))
    assert [p for p, _ in sent] == ["accounts"]


def test_lean_fields_when_tally_refuses_transport_fields(cfg, monkeypatch):
    real = tally.post
    def picky(url, body, timeout=120):
        if "SNJAccounts" in body and "BillOfLadingNo" in body:
            return tally.parse_xml("<ENVELOPE></ENVELOPE>")
        return real(url, body, timeout)
    monkeypatch.setattr(tally, "post", picky)
    types = bridge.account_types(bridge.voucher_types(cfg))
    entries = bridge.read_account_chunk(cfg, types, {"Agarwal Hosiery"}, dt.date(2026, 10, 1), dt.date(2026, 10, 31))
    assert len(entries) == 2 and bridge._acct_variants == ["plain"]
