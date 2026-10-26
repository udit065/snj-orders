"""Read-only: customers' balances, open bills and account vouchers from Tally.

Like tally.py, only "Export" requests are built here. Amounts keep Tally's sign
(debit negative) when read, and are turned round on the way out so that a
positive number is always money the customer owes SNJ.
"""

import datetime as dt
import re
from xml.sax.saxutils import escape

import tally
from tally import _date, _envelope, _text

# Vouchers that change what a customer owes.
ACCOUNT_BASES = {"Sales", "Credit Note", "Receipt", "Debit Note", "Journal", "Payment"}

_SIGNED = re.compile(r"-?[\d,]*\.?\d+")


def signed(s):
    """'-12,345.50' -> -12345.5. Tally writes debits as negative numbers."""
    m = _SIGNED.search((s or "").replace(" ", ""))
    return float(m.group().replace(",", "")) if m else 0.0


def credit_days(s):
    """'30 Days' -> 30; a bare date or nothing -> None."""
    m = re.match(r"^\s*(\d+)\s*Days?\s*$", s or "", re.I)
    return int(m.group(1)) if m else None


# --- customers' balances ------------------------------------------------------------

# Tried in order; a build that refuses a field gets the next, shorter list.
BALANCE_FIELDS = (
    ["Name", "Parent", "OpeningBalance", "ClosingBalance", "CreditLimit", "BillCreditPeriod"],
    ["Name", "Parent", "OpeningBalance", "ClosingBalance"],
)


def parse_balances(groups_root, ledgers_root):
    """Every ledger under Sundry Debtors with what it owes (positive = owes SNJ)."""
    names = {c["name"] for c in tally.parse_customers(groups_root, ledgers_root)}
    out = []
    for l in ledgers_root.iter("LEDGER"):
        name = (l.get("NAME") or _text(l, "NAME")).strip()
        if name not in names:
            continue
        limit = abs(signed(_text(l, "CREDITLIMIT")))
        out.append({
            "name": name,
            "opening": round(-signed(_text(l, "OPENINGBALANCE")), 2),
            "closing": round(-signed(_text(l, "CLOSINGBALANCE")), 2),
            "credit_limit": round(limit, 2) if limit else None,
            "credit_days": credit_days(_text(l, "BILLCREDITPERIOD")),
        })
    return sorted(out, key=lambda p: p["name"])


# --- open bills -------------------------------------------------------------------

def bills_request(to_date, company=None):
    """Tally's own Bills Receivable report: every customer bill not yet fully paid."""
    statics = "<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>"
    if company:
        statics += f"<SVCURRENTCOMPANY>{escape(company)}</SVCURRENTCOMPANY>"
    statics += f"<SVTODATE>{to_date:%Y%m%d}</SVTODATE>"
    return ("<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>"
            "<TYPE>Data</TYPE><ID>Bills Receivable</ID></HEADER><BODY><DESC>"
            f"<STATICVARIABLES>{statics}</STATICVARIABLES></DESC></BODY></ENVELOPE>")


def parse_bills(root):
    """The report is a flat run of BILLFIXED, BILLCL, BILLDUE, BILLOVERDUE per bill."""
    bills, cur = [], None
    for el in root.iter():
        if el.tag == "BILLFIXED":
            cur = {"party": _text(el, "BILLPARTY"), "ref": _text(el, "BILLREF"),
                   "date": _date(_text(el, "BILLDATE")), "due_date": "", "amount": 0.0}
            bills.append(cur)
        elif cur is not None and el.tag == "BILLCL":
            cur["amount"] = round(-signed(el.text), 2)
        elif cur is not None and el.tag == "BILLDUE":
            cur["due_date"] = _date((el.text or "").strip())
    return [b for b in bills if b["party"] and b["amount"]]


# --- account vouchers -------------------------------------------------------------

_LEDGER = "AllLedgerEntries.LedgerName, AllLedgerEntries.Amount, AllLedgerEntries.BillAllocations"
_SHIP = ("BasicShipDocumentNo, BasicShippedBy, BillOfLadingNo, BillOfLadingDate, BasicShipVesselNo,"
         " BasicFinalDestination")
_ITEMS = ("AllInventoryEntries.StockItemName, AllInventoryEntries.ActualQty, AllInventoryEntries.BilledQty,"
          " AllInventoryEntries.Rate, AllInventoryEntries.Amount, AllInventoryEntries.BatchAllocations")
_HEAD = "Guid, Date, VoucherTypeName, VoucherNumber, PartyLedgerName"
FETCH_VARIANTS = {
    "rich": f"{_HEAD}, Reference, Narration, IsCancelled, {_SHIP}, {_LEDGER}, {_ITEMS}",
    "plain": f"{_HEAD}, Reference, Narration, IsCancelled, {_LEDGER}, {_ITEMS}",
    "lean": f"{_HEAD}, {_LEDGER}",
}


def vouchers_request(type_names, from_date, to_date, company=None, variant="rich"):
    types = " OR ".join(f'$VoucherTypeName = "{escape(n)}"' for n in sorted(type_names))
    period = f'$Date &gt;= $$Date:"{from_date:%Y%m%d}" AND $Date &lt;= $$Date:"{to_date:%Y%m%d}"'
    tdl = (
        '<COLLECTION NAME="SNJAccounts" ISMODIFY="No">'
        f"<TYPE>Voucher</TYPE><FETCH>{FETCH_VARIANTS[variant]}</FETCH>"
        "<FILTER>SNJAcPeriod,SNJAcTypes</FILTER></COLLECTION>"
        f'<SYSTEM TYPE="Formulae" NAME="SNJAcPeriod">{period}</SYSTEM>'
        f'<SYSTEM TYPE="Formulae" NAME="SNJAcTypes">{types}</SYSTEM>'
    )
    return _envelope("SNJAccounts", tdl, company)


def _ledger_entries(v):
    for tag in ("ALLLEDGERENTRIES.LIST", "LEDGERENTRIES.LIST"):
        for e in v.findall(tag):
            yield e


def parse_vouchers(root, base_types, customers):
    """One entry per voucher and customer, with what it did to their balance."""
    out = []
    for v in root.iter("VOUCHER"):
        if _text(v, "ISCANCELLED") == "Yes" or _text(v, "ISDELETED") == "Yes":
            continue
        vtype = _text(v, "VOUCHERTYPENAME") or v.get("VCHTYPE", "")
        base = base_types.get(vtype, vtype)
        if base not in ACCOUNT_BASES:
            continue
        guid = _text(v, "GUID") or v.get("REMOTEID", "")
        vdate = _date(_text(v, "DATE"))
        per_party = {}
        for e in _ledger_entries(v):
            name = _text(e, "LEDGERNAME")
            if name not in customers:
                continue
            p = per_party.setdefault(name, {"amount": 0.0, "bills": []})
            p["amount"] += -signed(_text(e, "AMOUNT"))
            for b in e.findall("BILLALLOCATIONS.LIST"):
                ref = _text(b, "NAME")
                if not ref and _text(b, "BILLTYPE") != "On Account":
                    continue
                p["bills"].append({"ref": ref, "type": _text(b, "BILLTYPE"),
                                   "amount": round(-signed(_text(b, "AMOUNT")), 2),
                                   "credit_days": credit_days(_text(b, "BILLCREDITPERIOD"))})
        if not per_party:
            continue
        ship = {k: _text(v, tag) for k, tag in (
            ("doc_no", "BASICSHIPDOCUMENTNO"), ("shipped_by", "BASICSHIPPEDBY"), ("lr_no", "BILLOFLADINGNO"),
            ("vehicle", "BASICSHIPVESSELNO"), ("destination", "BASICFINALDESTINATION"))}
        ship["lr_date"] = _date(_text(v, "BILLOFLADINGDATE"))
        lines = [{k: l[k] for k in ("item", "size", "qty", "unit", "rate", "amount")}
                 for l in tally._lines(v, vdate)] if base == "Sales" else []
        for party, p in per_party.items():
            out.append({
                "id": f"{guid}|{party}", "guid": guid, "date": vdate, "number": _text(v, "VOUCHERNUMBER"),
                "voucher_type": vtype, "base": base, "party": party, "amount": round(p["amount"], 2),
                "bills": p["bills"], "reference": _text(v, "REFERENCE"), "narration": _text(v, "NARRATION"),
                "ship": ship if any(ship.values()) else None, "lines": lines,
            })
    return out


def fy_start(today=None):
    """1 April of the Indian financial year `today` falls in."""
    today = today or dt.date.today()
    return dt.date(today.year if today.month >= 4 else today.year - 1, 4, 1)
