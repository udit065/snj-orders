"""Writing new Sales Orders into Tally: the bridge's only write path.

Off unless config.ini says allow_writes = yes, and then only into write_company
(a test copy of the company first). Everything here follows what the colleague's
tally_bridge/order_importer.py learned writing orders into this same Tally:

  * Only a "Sales Order" voucher with ACTION="Create" is ever sent; the outgoing
    bytes are checked just before each send, and anything else is refused.
  * Party and item names must exactly match Tally's masters, or Tally silently
    creates a new master. Names are checked against write_company first.
  * This Tally refuses zero-value orders, so every line needs a rate, and every
    amount is re-worked from rate x qty x discount before sending.
  * No godown is written (Tally's "Any" is the absence of one). Each size is a
    batch carrying ORDERNO and its own ORDERDUEDATE ("1-Sep-26").
  * Every voucher binds to the company's GST registration.
  * An order is sent exactly once. If the answer is lost after sending, it is
    marked failed with "check Tally": the order may exist, so it is never resent.
"""

import datetime as dt
import re
import urllib.request
from xml.sax.saxutils import escape

ALLOWED_VCHTYPE = "Sales Order"
# SNJ sells on a 50% then 20% discount chain: Tally keeps the first step in DISCOUNT
# and the fully netted figure in AMOUNT (rate x qty x 0.4).
DISCOUNTS = {"50+20": (50, 0.4), "none": (0, 1.0)}
_TOL = 0.02

# First two digits of a GSTIN are the state code; orders carry the place of supply.
GST_STATES = {
    "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
    "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
    "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
    "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
    "35": "Andaman & Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
}


class Refused(Exception):
    """The order can't be sent as it is; nothing went to Tally."""


def net(rate, qty, discount):
    return round(rate * qty * DISCOUNTS[discount][1], 2)


def _due(s):
    d = dt.date.fromisoformat(s)
    return f"{d.day}-{d:%b-%y}"


def check_masters(order, customers, items):
    """Names must exactly match Tally's masters; returns what's missing."""
    missing = []
    if order["party"] not in customers:
        missing.append(f"customer {order['party']!r}")
    for name in dict.fromkeys(l["item"] for l in order["lines"]):
        if name not in items:
            missing.append(f"item {name!r}")
    return missing


def build_sales_order(order, company, settings, gstin=""):
    """The import envelope for one order from the website."""
    esc = escape
    d = order["date"].replace("-", "")
    inventory, total = [], 0.0
    for line in order["lines"]:
        rate, unit, discount = float(line["rate"]), line["unit"], line.get("discount", "50+20")
        if discount not in DISCOUNTS:
            raise Refused(f"unknown discount {discount!r}")
        first = DISCOUNTS[discount][0]
        disc_tag = f"<DISCOUNT>{first:g}</DISCOUNT>" if first else ""
        batch_disc = f"<BATCHDISCOUNT>{first:g}</BATCHDISCOUNT>" if first else ""
        batches, line_amount, line_qty = [], 0.0, 0.0
        for s in line["sizes"]:
            qty = float(s["qty"])
            amount = net(rate, qty, discount)
            line_amount += amount
            line_qty += qty
            batches.append(
                "<BATCHALLOCATIONS.LIST>"
                f"<BATCHNAME>{esc(s.get('size') or 'Primary Batch')}</BATCHNAME>"
                f"<ORDERNO>{esc(order['order_no'])}</ORDERNO>"
                f"<BATCHRATE>{rate:.2f}/{esc(unit)}</BATCHRATE>{batch_disc}"
                f"<AMOUNT>{amount:.2f}</AMOUNT>"
                f"<ACTUALQTY>{qty:.2f} {esc(unit)}</ACTUALQTY><BILLEDQTY>{qty:.2f} {esc(unit)}</BILLEDQTY>"
                f"<ORDERDUEDATE>{_due(s['due_date'])}</ORDERDUEDATE>"
                "</BATCHALLOCATIONS.LIST>")
        # The line takes the sum of its rounded sizes, so the two always agree.
        line_amount = round(line_amount, 2)
        total += line_amount
        inventory.append(
            "<ALLINVENTORYENTRIES.LIST>"
            f"<STOCKITEMNAME>{esc(line['item'])}</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>"
            f"<RATE>{rate:.2f}/{esc(unit)}</RATE>{disc_tag}<AMOUNT>{line_amount:.2f}</AMOUNT>"
            f"<ACTUALQTY>{line_qty:.2f} {esc(unit)}</ACTUALQTY><BILLEDQTY>{line_qty:.2f} {esc(unit)}</BILLEDQTY>"
            + "".join(batches)
            + "<ACCOUNTINGALLOCATIONS.LIST>"
            f"<LEDGERNAME>{esc(settings['sales_ledger'])}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>"
            # Without REMOVEZEROENTRIES=No Tally can drop the lines and import an empty order.
            "<LEDGERFROMITEM>No</LEDGERFROMITEM><REMOVEZEROENTRIES>No</REMOVEZEROENTRIES>"
            f"<ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>{line_amount:.2f}</AMOUNT>"
            "</ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>")
    state = GST_STATES.get(gstin[:2], "") if gstin else ""
    party = esc(order["party"])
    xml = (
        "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST>"
        "<TYPE>Data</TYPE><ID>Vouchers</ID></HEADER><BODY><DESC><STATICVARIABLES>"
        f"<SVCURRENTCOMPANY>{esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES></DESC>"
        '<DATA><TALLYMESSAGE xmlns:UDF="TallyUDF">'
        f'<VOUCHER VCHTYPE="{ALLOWED_VCHTYPE}" ACTION="Create" OBJVIEW="Invoice Voucher View">'
        f"<DATE>{d}</DATE><EFFECTIVEDATE>{d}</EFFECTIVEDATE>"
        f"<VOUCHERTYPENAME>{ALLOWED_VCHTYPE}</VOUCHERTYPENAME>"
        f"<VOUCHERNUMBER>{esc(order['order_no'])}</VOUCHERNUMBER>"
        f"<REFERENCE>{esc(order.get('reference') or order['order_no'])}</REFERENCE>"
        f"<PARTYLEDGERNAME>{party}</PARTYLEDGERNAME><PARTYNAME>{party}</PARTYNAME>"
        f"<BASICBASEPARTYNAME>{party}</BASICBASEPARTYNAME><BASICBUYERNAME>{party}</BASICBUYERNAME>"
        "<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>No</ISINVOICE>"
        "<NUMBERINGSTYLE>Manual</NUMBERINGSTYLE><VOUCHERNUMBERSERIES>Default</VOUCHERNUMBERSERIES>"
        f'<GSTREGISTRATION TAXTYPE="GST" TAXREGISTRATION="{esc(settings["company_gstin"])}">'
        f"{esc(settings['gst_registration'])}</GSTREGISTRATION>"
        f"<CMPGSTIN>{esc(settings['company_gstin'])}</CMPGSTIN>"
        + (f"<PARTYGSTIN>{esc(gstin)}</PARTYGSTIN>" if gstin else "")
        + (f"<PLACEOFSUPPLY>{esc(state)}</PLACEOFSUPPLY><STATENAME>{esc(state)}</STATENAME>"
           f"<CONSIGNEESTATENAME>{esc(state)}</CONSIGNEESTATENAME>" if state else "")
        + f"<NARRATION>{esc(order.get('narration', ''))}</NARRATION>"
        + "".join(inventory)
        + f"<LEDGERENTRIES.LIST><LEDGERNAME>{party}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>"
        "<LEDGERFROMITEM>No</LEDGERFROMITEM><REMOVEZEROENTRIES>No</REMOVEZEROENTRIES>"
        # Debits export negative in Tally: the party owes the total.
        f"<ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>{-total:.2f}</AMOUNT></LEDGERENTRIES.LIST>"
        "</VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>")
    check_envelope(xml)
    return xml


def check_envelope(xml):
    """The safety rules, checked on the bytes about to be sent."""
    if re.findall(r'VCHTYPE="([^"]*)"', xml) != [ALLOWED_VCHTYPE] \
            or re.findall(r"<VOUCHERTYPENAME>([^<]*)<", xml) != [ALLOWED_VCHTYPE]:
        raise Refused("not exactly one Sales Order voucher")
    if re.findall(r'ACTION="([^"]*)"', xml) != ["Create"]:
        raise Refused("only new orders can be created")
    if "<MRP" in xml or "<GODOWNNAME>" in xml:
        raise Refused("MRP and godowns are never written")
    total = 0.0
    for block in re.findall(r"<ALLINVENTORYENTRIES\.LIST>(.*?)</ALLINVENTORYENTRIES\.LIST>", xml, re.S):
        rate = float(re.search(r"<RATE>([\d.]+)/", block).group(1))
        disc = re.search(r"<DISCOUNT>([\d.]+)</DISCOUNT>", block)
        factor = DISCOUNTS["50+20" if disc else "none"][1]
        qty = float(re.search(r"<ACTUALQTY>([\d.]+) ", block).group(1))
        amount = float(re.search(r"<AMOUNT>(-?[\d.]+)</AMOUNT>", block).group(1))
        if rate <= 0 or qty <= 0:
            raise Refused("every line needs a rate and a quantity (Tally refuses zero-value orders)")
        if abs(amount - rate * qty * factor) > _TOL * max(1, len(re.findall("<BATCHNAME>", block))):
            raise Refused(f"line amount {amount} isn't rate {rate} x qty {qty} x {factor}")
        sizes = sum(float(a) for a in re.findall(
            r"<BATCHALLOCATIONS\.LIST>(?:(?!</BATCHALLOCATIONS).)*?<AMOUNT>([\d.]+)</AMOUNT>", block, re.S))
        if abs(sizes - amount) > _TOL:
            raise Refused(f"sizes add up to {sizes}, not the line's {amount}")
        total += amount
    party = re.search(r"<LEDGERENTRIES\.LIST>.*?<AMOUNT>(-?[\d.]+)</AMOUNT>", xml, re.S)
    if not total or not party or abs(float(party.group(1)) + total) > _TOL:
        raise Refused("the customer's amount must be minus the order total")


def send_once(url, xml, timeout=120):
    """Send an import exactly once. Returns (ok, voucher_or_error, answered)."""
    check_envelope(xml)
    req = urllib.request.Request(url, data=xml.encode("utf-8"),
                                 headers={"Content-Type": "text/xml; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except OSError as e:
        return False, (f"No answer from Tally ({getattr(e, 'reason', e)}). CHECK TALLY before "
                       "entering it again: the order may have been created."), False

    def num(tag):
        m = re.search(rf"<{tag}>\s*(-?\d+)\s*</{tag}>", text)
        return int(m.group(1)) if m else 0

    err = re.search(r"<LINEERROR>(.*?)</LINEERROR>", text, re.S)
    if num("CREATED") > 0 and not err:
        return True, "", True
    detail = err.group(1).strip() if err else " ".join(text.split())[:300]
    return False, f"Tally didn't create the order: {detail}", True
