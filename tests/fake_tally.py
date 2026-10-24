"""A stand-in for Tally's XML port, serving sample data. Refuses anything but Export.

Like SNJ's real TallyPrime 7, it filters vouchers by the date formula in the
request, and (when REJECT_RICH is set) answers zero rows to a field list it
doesn't know.
"""
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
REQUESTS = []
REJECT_RICH = False
IMPORTS = []          # import envelopes Tally "created"
ACCEPT_IMPORTS = True
COMPANIES = ["SN JAIN INDUSTRIES PVT LTD - (26-27)", "SNJ TEST"]
MASTERS = {
    "SNJGroups": '<GROUP NAME="Sundry Debtors"><PARENT>Current Assets</PARENT></GROUP>'
                 '<GROUP NAME="Debtors - Rajasthan"><PARENT>Sundry Debtors</PARENT></GROUP>'
                 '<GROUP NAME="Sundry Creditors"><PARENT>Current Liabilities</PARENT></GROUP>',
    "SNJLedgers": '<LEDGER NAME="Agarwal Hosiery"><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>19AAAPA1234A1Z5</PARTYGSTIN></LEDGER>'
                  '<LEDGER NAME="Mehta &amp; Sons"><PARENT>Debtors - Rajasthan</PARENT><PARTYGSTIN>08AAAPM1234A1Z5</PARTYGSTIN></LEDGER>'
                  '<LEDGER NAME="Cotton Mills"><PARENT>Sundry Creditors</PARENT></LEDGER>'
                  '<LEDGER NAME="Sale Central 5%"><PARENT>Sales Accounts</PARENT></LEDGER>',
    "SNJStockItems": '<STOCKITEM NAME="001 SPORT BRA (28X40)-(Doz)"><BASEUNITS>Doz</BASEUNITS></STOCKITEM>'
                     '<STOCKITEM NAME="NIKER S-XL-(Doz)"><BASEUNITS>Doz</BASEUNITS></STOCKITEM>',
}
_VOUCHER = re.compile(r"<VOUCHER\b.*?</VOUCHER>", re.S)


def vouchers_between(lo, hi):
    text = open(os.path.join(HERE, "vouchers.xml"), encoding="utf-8").read()
    keep = [v for v in _VOUCHER.findall(text) if lo <= re.search(r"<DATE>(\d{8})</DATE>", v).group(1) <= hi]
    return "<ENVELOPE><COLLECTION>" + "".join(keep) + "</COLLECTION></ENVELOPE>"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"])).decode()
        REQUESTS.append(body)
        if "<TALLYREQUEST>Import</TALLYREQUEST>" in body:
            if ACCEPT_IMPORTS:
                IMPORTS.append(body)
                out = "<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><LASTVCHID>77</LASTVCHID></RESPONSE>"
            else:
                out = "<RESPONSE><CREATED>0</CREATED><LINEERROR>Voucher totals do not match!</LINEERROR></RESPONSE>"
        elif "<TALLYREQUEST>Export</TALLYREQUEST>" not in body:
            out = "<RESPONSE><LINEERROR>Only export allowed in tests</LINEERROR></RESPONSE>"
        elif "SNJCompanies" in body:
            out = "<ENVELOPE>" + "".join(f'<COMPANY NAME="{c}"/>' for c in COMPANIES) + "</ENVELOPE>"
        elif any(k in body for k in MASTERS):
            out = "<ENVELOPE>" + next(v for k, v in MASTERS.items() if k in body) + "</ENVELOPE>"
        elif "SNJVchTypes" in body:
            out = open(os.path.join(HERE, "voucher_types.xml"), encoding="utf-8").read()
        elif REJECT_RICH and "Narration" in body:
            out = "<ENVELOPE></ENVELOPE>"
        else:
            lo, hi = re.findall(r'\$\$Date:"(\d{8})"', body)
            out = vouchers_between(lo, hi)
        data = out.encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 9000), Handler).serve_forever()
