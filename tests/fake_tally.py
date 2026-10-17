"""A stand-in for Tally's XML port, serving sample data. Refuses anything but Export."""
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
REQUESTS = []


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"])).decode()
        REQUESTS.append(body)
        if "<TALLYREQUEST>Export</TALLYREQUEST>" not in body:
            out = "<RESPONSE><LINEERROR>Only export allowed in tests</LINEERROR></RESPONSE>"
        else:
            name = "voucher_types.xml" if "SNJVchTypes" in body else "vouchers.xml"
            out = open(os.path.join(HERE, name), encoding="utf-8").read()
        data = out.encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 9000), Handler).serve_forever()
