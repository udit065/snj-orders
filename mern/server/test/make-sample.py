"""Writes fixtures/sample-sync.json: what the Python bridge reads from tests/fake_tally.py."""
import datetime as dt
import json
import os
import sys
import threading
from http.server import HTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path[:0] = [os.path.join(ROOT, "bridge"), os.path.join(ROOT, "tests")]
import bridge  # noqa: E402
import fake_tally  # noqa: E402

srv = HTTPServer(("127.0.0.1", 0), fake_tally.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
cfg = {"company": "SN JAIN INDUSTRIES PVT LTD - (26-27)", "timeout": 30, "days_per_request": 31,
       "tally_url": f"http://127.0.0.1:{srv.server_port}"}
orders, fulfilments = bridge.read_tally(cfg, dt.date(2026, 9, 1), dt.date(2026, 11, 30))
with open(os.path.join(os.path.dirname(__file__), "fixtures", "sample-sync.json"), "w") as f:
    json.dump({"orders": orders, "fulfilments": fulfilments}, f, indent=1)
