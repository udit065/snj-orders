"""Read-only access to Tally Prime over its XML port.

Only "Export" requests are ever built here, so nothing in this module can
create, change or delete anything in Tally.
"""

import datetime as dt
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
_PREFIXED_TAG = re.compile(r"<(/?)([A-Za-z_][\w.\-]*):")


class TallyError(Exception):
    pass


def _envelope(collection_id, tdl, company=None):
    statics = "<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>"
    if company:
        statics += f"<SVCURRENTCOMPANY>{escape(company)}</SVCURRENTCOMPANY>"
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


def companies_request():
    tdl = ('<COLLECTION NAME="SNJCompanies" ISMODIFY="No"><TYPE>Company</TYPE>'
           "<NATIVEMETHOD>Name</NATIVEMETHOD></COLLECTION>")
    return _envelope("SNJCompanies", tdl)


def open_companies(root):
    # Strip: a trailing space in a name would make exact matches fail invisibly.
    return [(c.get("NAME") or _text(c, "NAME")).strip() for c in root.iter("COMPANY")
            if (c.get("NAME") or _text(c, "NAME")).strip()]


def masters_request(tally_type, fields, company=None):
    """Groups, ledgers or stock items, with the given fields."""
    coll = f"SNJ{tally_type}s"
    methods = "".join(f"<NATIVEMETHOD>{f}</NATIVEMETHOD>" for f in fields)
    tdl = f'<COLLECTION NAME="{coll}" ISMODIFY="No"><TYPE>{tally_type}</TYPE>{methods}</COLLECTION>'
    return _envelope(coll, tdl, company)


def parse_customers(groups_root, ledgers_root):
    """Ledgers anywhere under Sundry Debtors, with GSTIN and state: the parties orders are for."""
    parent = {}
    for g in groups_root.iter("GROUP"):
        name = (g.get("NAME") or _text(g, "NAME")).strip()
        if name:
            parent[name] = _text(g, "PARENT")

    def under_debtors(group):
        seen = set()
        while group and group not in seen:
            if group == "Sundry Debtors":
                return True
            seen.add(group)
            group = parent.get(group, "")
        return False

    out = []
    for l in ledgers_root.iter("LEDGER"):
        name = (l.get("NAME") or _text(l, "NAME")).strip()
        if name and under_debtors(_text(l, "PARENT")):
            out.append({"name": name, "gstin": _text(l, "PARTYGSTIN"), "state": _text(l, "LEDSTATENAME")})
    return sorted(out, key=lambda c: c["name"])


def ledger_names(ledgers_root):
    return {(l.get("NAME") or _text(l, "NAME")).strip() for l in ledgers_root.iter("LEDGER")} - {""}


def parse_items(root):
    out = []
    for i in root.iter("STOCKITEM"):
        name = (i.get("NAME") or _text(i, "NAME")).strip()
        if name:
            out.append({"name": name, "unit": _text(i, "BASEUNITS")})
    return sorted(out, key=lambda i: i["name"])


# On SNJ's TallyPrime 7 (Edit Log) a voucher collection answers with ZERO rows,
# and no error, if a single FETCH field is unknown to the build. So the bridge
# tries the rich field list first and falls back to the lean one.
_INVENTORY_FIELDS = ("AllInventoryEntries.StockItemName, AllInventoryEntries.ActualQty,"
                     " AllInventoryEntries.BilledQty, AllInventoryEntries.Rate,"
                     " AllInventoryEntries.Amount, AllInventoryEntries.BatchAllocations")
FETCH_VARIANTS = {
    "rich": ("Guid, Date, VoucherTypeName, VoucherNumber, PartyLedgerName, Reference, Narration,"
             " MasterID, AlterID, IsCancelled, IsOptional, " + _INVENTORY_FIELDS),
    "lean": "Guid, Date, VoucherTypeName, VoucherNumber, PartyLedgerName, " + _INVENTORY_FIELDS,
}
# Used when Tally won't list voucher types: the built-in names.
DEFAULT_TYPES = {n: n for n in ORDER_BASES | FULFIL_BASES}


def vouchers_request(type_names, from_date, to_date, company=None, variant="rich"):
    # A Collection has no report period, so SVFROMDATE/SVTODATE do nothing here;
    # the date range has to be a filter formula.
    types = " OR ".join(f'$VoucherTypeName = "{escape(n)}"' for n in sorted(type_names))
    period = f'$Date &gt;= $$Date:"{from_date:%Y%m%d}" AND $Date &lt;= $$Date:"{to_date:%Y%m%d}"'
    tdl = (
        '<COLLECTION NAME="SNJVouchers" ISMODIFY="No">'
        f"<TYPE>Voucher</TYPE><FETCH>{FETCH_VARIANTS[variant]}</FETCH>"
        "<FILTER>SNJPeriod,SNJTypes</FILTER></COLLECTION>"
        f'<SYSTEM TYPE="Formulae" NAME="SNJPeriod">{period}</SYSTEM>'
        f'<SYSTEM TYPE="Formulae" NAME="SNJTypes">{types}</SYSTEM>'
    )
    return _envelope("SNJVouchers", tdl, company)


def post(url, body, timeout=120):
    req = urllib.request.Request(
        url, data=body.encode("utf-8"), headers={"Content-Type": "text/xml; charset=utf-8"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except OSError as e:
        raise TallyError(
            f"Could not reach Tally at {url} ({getattr(e, 'reason', e)}).\n"
            "Check that TallyPrime is open on this server with the company loaded, and that\n"
            "F1 Help > Settings > Connectivity > Client/Server configuration says\n"
            "'TallyPrime acts as: Server' (or Both) on the same port as tally_url in config.ini.")
    return parse_xml(raw)


def parse_xml(raw):
    raw = _BAD_CHARS.sub("", raw)
    # User Defined Fields come as <UDF:NAME>, an undeclared XML prefix that
    # ElementTree rejects; rename them to <UDF_NAME>.
    while True:
        fixed = _PREFIXED_TAG.sub(r"<\1\2_", raw)
        if fixed == raw:
            break
        raw = fixed
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
    """Tally dates: '20261012', '12-Oct-26' or '12-Oct-2026' -> '2026-10-12'."""
    s = (s or "").strip()
    for fmt in ("%Y%m%d", "%d-%b-%y", "%d-%b-%Y"):
        try:
            return dt.datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return ""


_DAYS = re.compile(r"^(\d+)\s*Days?$", re.I)


def _due_date(s, voucher_date):
    """Order due dates are a date, or 'N Days' counted from the order date."""
    s = (s or "").strip()
    m = _DAYS.match(s)
    if m and voucher_date:
        return (dt.date.fromisoformat(voucher_date) + dt.timedelta(days=int(m.group(1)))).isoformat()
    return _date(s.split()[0] if s else "")


# Batch names that mean "no batch" rather than a size.
_NO_BATCH = {"", "primary batch", "any", "not applicable"}


def _lines(v, vdate):
    """One line per item and size. SNJ keeps sizes as Tally batches."""
    lines = []
    for inv in v.findall("ALLINVENTORYENTRIES.LIST"):
        item = _text(inv, "STOCKITEMNAME")
        if not item:
            continue
        qty, unit = parse_qty(_text(inv, "ACTUALQTY") or _text(inv, "BILLEDQTY"))
        rate = parse_rate(_text(inv, "RATE"))
        batches = [b for b in inv.findall("BATCHALLOCATIONS.LIST")
                   if parse_qty(_text(b, "ACTUALQTY") or _text(b, "BILLEDQTY"))[0]]
        if not batches:
            lines.append({"item": item, "size": "", "qty": qty, "unit": unit, "rate": rate,
                          "amount": parse_amount(_text(inv, "AMOUNT")), "due_date": "",
                          "godown": "", "order_no": ""})
            continue
        for b in batches:
            bqty, bunit = parse_qty(_text(b, "ACTUALQTY") or _text(b, "BILLEDQTY"))
            size = _text(b, "BATCHNAME")
            order_no = _text(b, "ORDERNO")
            lines.append({
                "item": item,
                "size": "" if size.lower() in _NO_BATCH else size,
                "qty": bqty, "unit": bunit or unit, "rate": rate,
                "amount": parse_amount(_text(b, "AMOUNT")) or round(bqty * rate, 2),
                "due_date": _due_date(_text(b, "ORDERDUEDATE"), vdate),
                "godown": "" if _text(b, "GODOWNNAME").lower() in _NO_BATCH else _text(b, "GODOWNNAME"),
                "order_no": "" if order_no.lower() in _NO_BATCH else order_no,
            })
    return lines


def parse_vouchers(root, base_types):
    orders, fulfilments = [], []
    for v in root.iter("VOUCHER"):
        if _text(v, "ISCANCELLED") == "Yes" or _text(v, "ISDELETED") == "Yes":
            continue
        vtype = _text(v, "VOUCHERTYPENAME") or v.get("VCHTYPE", "")
        base = base_types.get(vtype, vtype)
        if base not in ORDER_BASES | FULFIL_BASES:
            continue
        vdate = _date(_text(v, "DATE"))
        lines = _lines(v, vdate)
        record = {
            "guid": _text(v, "GUID") or v.get("REMOTEID", ""),
            "master_id": _text(v, "MASTERID"),
            "alter_id": _text(v, "ALTERID"),
            "date": vdate,
            "number": _text(v, "VOUCHERNUMBER"),
            "voucher_type": vtype,
            "kind": "sales" if base in SALES_SIDE else "purchase",
            "party": _text(v, "PARTYLEDGERNAME"),
            "reference": _text(v, "REFERENCE"),
            "narration": _text(v, "NARRATION"),
        }
        if base in ORDER_BASES:
            # Deliveries are tracked by "Order No", which defaults to the voucher number.
            for l in lines:
                l["order_no"] = l["order_no"] or record["number"]
            record["optional"] = _text(v, "ISOPTIONAL") == "Yes"
            # SNJ cancels an order by renaming it, e.g. "SO/D5/123 R(CANCEL)".
            record["cancelled"] = "CANCEL" in record["number"].upper()
            record["total"] = round(sum(l["amount"] for l in lines), 2)
            record["lines"] = lines
            orders.append(record)
        else:
            # Rejections send goods back, so they reduce what counts as delivered.
            sign = -1 if base.startswith("Rejections") else 1
            for l in lines:
                if l["order_no"]:
                    fulfilments.append({
                        "kind": record["kind"], "party": record["party"], "order_no": l["order_no"],
                        "item": l["item"], "size": l["size"], "qty": sign * l["qty"],
                        "date": record["date"], "voucher": f'{vtype} {record["number"]}',
                    })
    return orders, fulfilments
