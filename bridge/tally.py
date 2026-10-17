"""Read-only access to Tally Prime over its XML port.

Only "Export" requests are ever built here, so nothing in this module can
create, change or delete anything in Tally.
"""

import re
import urllib.request
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ORDER_BASES = {"Sales Order", "Purchase Order"}
# Vouchers that deliver goods against an order. Their batch allocations carry
# the order number they settle, which is how we work out what is still pending.
FULFIL_BASES = {"Sales", "Delivery Note", "Purchase", "Receipt Note", "Rejections In", "Rejections Out"}
SALES_SIDE = {"Sales Order", "Sales", "Delivery Note", "Rejections In"}

# Tally puts control characters like &#4; in some text; strip anything XML can't hold.
_BAD_CHARS = re.compile(r"&#(?:[0-8]|1[124-9]|2[0-9]|3[01]);")


class TallyError(Exception):
    pass


def _envelope(collection_id, tdl, from_date=None, to_date=None, company=None):
    statics = "<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>"
    if company:
        statics += f"<SVCURRENTCOMPANY>{escape(company)}</SVCURRENTCOMPANY>"
    if from_date:
        statics += f"<SVFROMDATE>{from_date:%Y%m%d}</SVFROMDATE><SVTODATE>{to_date:%Y%m%d}</SVTODATE>"
    return (
        "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>"
        f"<TYPE>Collection</TYPE><ID>{collection_id}</ID></HEADER><BODY><DESC>"
        f"<STATICVARIABLES>{statics}</STATICVARIABLES>"
        f"<TDL><TDLMESSAGE>{tdl}</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
    )


def voucher_types_request(company=None):
    tdl = (
        '<COLLECTION NAME="SNJVchTypes" ISMODIFY="No">'
        "<TYPE>VoucherType</TYPE><NATIVEMETHOD>Name, Parent</NATIVEMETHOD>"
        "</COLLECTION>"
    )
    return _envelope("SNJVchTypes", tdl, company=company)


def vouchers_request(type_names, from_date, to_date, company=None):
    quoted = " OR ".join(f'$VoucherTypeName = "{escape(n)}"' for n in sorted(type_names))
    tdl = (
        '<COLLECTION NAME="SNJVouchers" ISMODIFY="No">'
        "<TYPE>Voucher</TYPE>"
        "<FETCH>Date, VoucherNumber, VoucherTypeName, PartyLedgerName, Reference, Narration,"
        " GUID, MasterID, AlterID, IsCancelled, IsOptional, IsDeleted,"
        " AllInventoryEntries.StockItemName, AllInventoryEntries.ActualQty,"
        " AllInventoryEntries.BilledQty, AllInventoryEntries.Rate,"
        " AllInventoryEntries.Amount, AllInventoryEntries.BatchAllocations</FETCH>"
        "<FILTER>SNJWanted</FILTER></COLLECTION>"
        f'<SYSTEM TYPE="Formulae" NAME="SNJWanted">{quoted}</SYSTEM>'
    )
    return _envelope("SNJVouchers", tdl, from_date, to_date, company)


def post(url, body, timeout=120):
    req = urllib.request.Request(
        url, data=body.encode("utf-8"), headers={"Content-Type": "text/xml; charset=utf-8"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except OSError as e:
        raise TallyError(f"Could not reach Tally at {url}. Is Tally open with the company loaded? ({e})")
    return parse_xml(raw)


def parse_xml(raw):
    raw = _BAD_CHARS.sub("", raw)
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        raise TallyError(f"Tally sent a reply that isn't valid XML: {e}")
    err = root.find(".//LINEERROR")
    if err is not None and (err.text or "").strip():
        raise TallyError(f"Tally error: {err.text.strip()}")
    return root


def _text(el, tag):
    found = el.find(tag)
    return (found.text or "").strip() if found is not None and found.text else ""


def resolve_base_types(root):
    """Map every voucher type name to the built-in type it descends from."""
    parent = {}
    for vt in root.iter("VOUCHERTYPE"):
        name = vt.get("NAME") or _text(vt, "NAME")
        if name:
            parent[name] = _text(vt, "PARENT") or name
    base = {}
    for name in parent:
        seen, cur = set(), name
        while parent.get(cur, cur) != cur and cur not in seen:
            seen.add(cur)
            cur = parent[cur]
        base[name] = cur
    return base


_NUM = re.compile(r"-?[\d,]*\.?\d+")


def parse_qty(s):
    """' 6 Doz' -> (6.0, 'Doz'); '2 Box = 24 Pcs' -> (2.0, 'Box')."""
    s = (s or "").split("=")[0].strip()
    m = _NUM.search(s)
    if not m:
        return 0.0, ""
    return abs(float(m.group().replace(",", ""))), s[m.end():].strip()


def parse_amount(s):
    m = _NUM.search((s or "").replace(" ", ""))
    return abs(float(m.group().replace(",", ""))) if m else 0.0


def parse_rate(s):
    """'120.00/Doz' -> 120.0"""
    return parse_amount((s or "").split("/")[0])


def _date(s):
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else s


def parse_vouchers(root, base_types):
    orders, fulfilments = [], []
    for v in root.iter("VOUCHER"):
        if _text(v, "ISCANCELLED") == "Yes" or _text(v, "ISDELETED") == "Yes":
            continue
        vtype = _text(v, "VOUCHERTYPENAME") or v.get("VCHTYPE", "")
        base = base_types.get(vtype, vtype)
        lines = []
        for inv in v.findall("ALLINVENTORYENTRIES.LIST"):
            qty, unit = parse_qty(_text(inv, "ACTUALQTY") or _text(inv, "BILLEDQTY"))
            batches = inv.findall("BATCHALLOCATIONS.LIST")
            line = {
                "item": _text(inv, "STOCKITEMNAME"),
                "qty": qty,
                "unit": unit,
                "rate": parse_rate(_text(inv, "RATE")),
                "amount": parse_amount(_text(inv, "AMOUNT")),
                "due_date": next((_date(_text(b, "ORDERDUEDATE").split()[0]) for b in batches
                                  if _text(b, "ORDERDUEDATE")), ""),
                "godown": next((_text(b, "GODOWNNAME") for b in batches if _text(b, "GODOWNNAME")), ""),
                "against": [
                    {"order_no": _text(b, "ORDERNO"), "qty": parse_qty(_text(b, "ACTUALQTY"))[0]}
                    for b in batches
                    if _text(b, "ORDERNO") and _text(b, "ORDERNO") != "Any"
                ],
            }
            if line["item"]:
                lines.append(line)
        record = {
            "guid": _text(v, "GUID"),
            "master_id": _text(v, "MASTERID"),
            "alter_id": _text(v, "ALTERID"),
            "date": _date(_text(v, "DATE")),
            "number": _text(v, "VOUCHERNUMBER"),
            "voucher_type": vtype,
            "kind": "sales" if base in SALES_SIDE else "purchase",
            "party": _text(v, "PARTYLEDGERNAME"),
            "reference": _text(v, "REFERENCE"),
            "narration": _text(v, "NARRATION"),
            "lines": lines,
        }
        if base in ORDER_BASES:
            record["optional"] = _text(v, "ISOPTIONAL") == "Yes"
            record["total"] = round(sum(l["amount"] for l in lines), 2)
            # The "Order No" Tally tracks deliveries by; it defaults to the voucher number.
            for l in lines:
                against = l.pop("against")
                l["order_no"] = against[0]["order_no"] if against else record["number"]
            orders.append(record)
        elif base in FULFIL_BASES:
            # Rejections send goods back, so they reduce what counts as delivered.
            sign = -1 if base.startswith("Rejections") else 1
            for l in lines:
                for a in l["against"]:
                    fulfilments.append({
                        "kind": record["kind"], "party": record["party"], "order_no": a["order_no"],
                        "item": l["item"], "qty": sign * (a["qty"] or l["qty"]),
                        "date": record["date"], "voucher": f'{vtype} {record["number"]}',
                    })
    return orders, fulfilments
