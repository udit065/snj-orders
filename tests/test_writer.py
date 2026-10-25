import os
import sys
import threading
from http.server import HTTPServer

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "bridge"), os.path.dirname(os.path.abspath(__file__))]

import fake_tally  # noqa: E402
import tally  # noqa: E402
import writer  # noqa: E402

SETTINGS = {"sales_ledger_local": "Sale Local 5%", "sales_ledger_central": "Sale Central 5%",
            "gst_registration": "Uttar Pradesh Registration",
            "company_gstin": "09ABHCS0526J1Z7"}
ORDER = {
    "order_no": "SO/W1/1", "date": "2026-10-24", "party": "Mehta & Sons", "reference": "", "narration": "By phone",
    "lines": [
        {"item": "NIKER S-XL-(Doz)", "unit": "Doz", "rate": 2400, "discount": "50+20",
         "sizes": [{"size": "36", "qty": 2.5, "due_date": "2026-11-01"}, {"size": "38", "qty": 1, "due_date": "2026-11-05"}]},
        {"item": "001 SPORT BRA (28X40)-(Doz)", "unit": "Doz", "rate": 1200, "discount": "none",
         "sizes": [{"size": "", "qty": 3, "due_date": "2026-11-01"}]},
    ],
}


@pytest.fixture()
def tally_url():
    fake_tally.REQUESTS.clear()
    fake_tally.IMPORTS.clear()
    fake_tally.ACCEPT_IMPORTS = True
    srv = HTTPServer(("127.0.0.1", 0), fake_tally.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_envelope_is_one_priced_sales_order():
    xml = writer.build_sales_order(ORDER, "SNJ TEST", SETTINGS, "08AAAPM1234A1Z5")
    assert 'VCHTYPE="Sales Order" ACTION="Create"' in xml and "<SVCURRENTCOMPANY>SNJ TEST<" in xml
    assert "<PARTYLEDGERNAME>Mehta &amp; Sons</PARTYLEDGERNAME>" in xml
    assert "<PLACEOFSUPPLY>Rajasthan</PLACEOFSUPPLY>" in xml
    # 2400 x 2.5 x 0.4 = 2400; 2400 x 1 x 0.4 = 960; 1200 x 3 (no discount) = 3600
    assert "<AMOUNT>3360.00</AMOUNT>" in xml and "<AMOUNT>3600.00</AMOUNT>" in xml
    assert "<AMOUNT>-6960.00</AMOUNT>" in xml
    assert "<ORDERDUEDATE>1-Nov-26</ORDERDUEDATE>" in xml and "<ORDERNO>SO/W1/1</ORDERNO>" in xml
    assert "<BATCHNAME>Primary Batch</BATCHNAME>" in xml and "<GODOWNNAME>" not in xml


@pytest.mark.parametrize("change, why", [
    (lambda x: x.replace('ACTION="Create"', 'ACTION="Delete"'), "only new orders"),
    (lambda x: x.replace('VCHTYPE="Sales Order"', 'VCHTYPE="Sales"'), "Sales Order"),
    (lambda x: x.replace("<AMOUNT>-6960.00</AMOUNT>", "<AMOUNT>-6000.00</AMOUNT>"), "minus the order total"),
    (lambda x: x.replace("<AMOUNT>3360.00</AMOUNT><ACTUALQTY>", "<AMOUNT>3000.00</AMOUNT><ACTUALQTY>", 1), "line amount"),
])
def test_unsafe_envelopes_are_refused(change, why):
    xml = writer.build_sales_order(ORDER, "SNJ TEST", SETTINGS, "08AAAPM1234A1Z5")
    with pytest.raises(writer.Refused, match=why):
        writer.check_envelope(change(xml))


def test_zero_rate_is_refused():
    bad = {**ORDER, "lines": [{**ORDER["lines"][0], "rate": 0}]}
    with pytest.raises(writer.Refused, match="rate"):
        writer.build_sales_order(bad, "SNJ TEST", SETTINGS, "08AAAPM1234A1Z5")


def test_sales_ledger_follows_the_customers_state():
    ledgers = {"Sale Local 5%", "Sale Central 5%"}
    assert writer.sales_ledger(SETTINGS, "09AAAPK1234A1Z5", "", ledgers) == ("Sale Local 5%", "Uttar Pradesh")
    assert writer.sales_ledger(SETTINGS, "08AAAPM1234A1Z5", "", ledgers) == ("Sale Central 5%", "Rajasthan")
    # No GSTIN (unregistered): the state on the customer's ledger decides.
    assert writer.sales_ledger(SETTINGS, "", "Uttar Pradesh", ledgers) == ("Sale Local 5%", "Uttar Pradesh")
    assert writer.sales_ledger(SETTINGS, "", "Bihar", ledgers)[0] == "Sale Central 5%"
    with pytest.raises(writer.Refused, match="no GSTIN or state"):
        writer.sales_ledger(SETTINGS, "", "", ledgers)
    with pytest.raises(writer.Refused, match="isn't in this company"):
        writer.sales_ledger(SETTINGS, "09AAAPK1234A1Z5", "", {"Sale Central 5%"})
    xml = writer.build_sales_order(ORDER, "SNJ TEST", SETTINGS, "09AAAPK1234A1Z5")
    assert "<LEDGERNAME>Sale Local 5%</LEDGERNAME>" in xml and "Sale Central" not in xml


def test_masters_must_match_exactly():
    assert writer.check_masters(ORDER, {"Mehta & Sons"}, {"NIKER S-XL-(Doz)"}) == [
        "item '001 SPORT BRA (28X40)-(Doz)'"]


def test_masters_and_sending(tally_url):
    customers = tally.parse_customers(tally.post(tally_url, tally.masters_request("Group", ["Name", "Parent"])),
                                      tally.post(tally_url, tally.masters_request("Ledger", ["Name"])))
    assert customers == [{"name": "Agarwal Hosiery", "gstin": "19AAAPA1234A1Z5", "state": ""},
                         {"name": "Gupta Traders", "gstin": "", "state": "Uttar Pradesh"},
                         {"name": "Mehta & Sons", "gstin": "08AAAPM1234A1Z5", "state": "Rajasthan"}]  # debtors only
    items = tally.parse_items(tally.post(tally_url, tally.masters_request("StockItem", ["Name", "BaseUnits"])))
    assert items[1] == {"name": "NIKER S-XL-(Doz)", "unit": "Doz"}
    assert "SNJ TEST" in tally.open_companies(tally.post(tally_url, tally.companies_request()))

    xml = writer.build_sales_order(ORDER, "SNJ TEST", SETTINGS, "08AAAPM1234A1Z5")
    assert writer.send_once(tally_url, xml) == (True, "", True)
    fake_tally.ACCEPT_IMPORTS = False
    ok, error, answered = writer.send_once(tally_url, xml)
    assert not ok and answered and "Voucher totals do not match" in error
    ok, error, answered = writer.send_once("http://127.0.0.1:1", xml)
    assert not ok and not answered and "CHECK TALLY" in error


def test_example_config_loads_with_percent_signs(tmp_path):
    import bridge
    cfg = tmp_path / "config.ini"
    cfg.write_text(open(os.path.join(ROOT, "bridge", "config.example.ini"), encoding="utf-8").read()
                   + "\n", encoding="utf-8")
    loaded = bridge.load_config(str(cfg))
    assert (loaded["sales_ledger_local"], loaded["sales_ledger_central"]) == ("Sale Local 5%", "Sale Central 5%")
