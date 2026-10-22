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
_VOUCHER = re.compile(r"<VOUCHER\b.*?</VOUCHER>", re.S)


def vouchers_between(lo, hi):
    text = open(os.path.join(HERE, "vouchers.xml"), encoding="utf-8").read()
    keep = [v for v in _VOUCHER.findall(text) if lo <= re.search(r"<DATE>(\d{8})</DATE>", v).group(1) <= hi]
    return "<ENVELOPE><COLLECTION>" + "".join(keep) + "</COLLECTION></ENVELOPE>"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"])).decode()
        REQUESTS.append(body)
        if "<TALLYREQUEST>Export</TALLYREQUEST>" not in body:
            out = "<RESPONSE><LINEERROR>Only export allowed in tests</LINEERROR></RESPONSE>"
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
