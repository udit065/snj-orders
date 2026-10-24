"""SNJ Orders bridge: copies sales and purchase orders from Tally to the website.

Runs on the Tally server. It only ever *reads* from Tally, and only makes
outgoing connections to the website, so no port is opened on the server.

    python bridge.py --once     # one round: recent days, plus a few minutes of the full copy
    python bridge.py            # keep doing rounds every few minutes
    python bridge.py --dry-run  # read Tally and print a summary, send nothing

A full copy of SNJ's books takes ~12 minutes to read, longer than a remote
session reliably stays connected. So it is sent a month at a time, with the
place it got to saved in state.json, and every round carries on from there.
install-task.cmd makes Windows run a round every 10 minutes in the background.
"""

import argparse
import configparser
import datetime as dt
import gzip
import json
import logging
import logging.handlers
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tally  # noqa: E402
import writer  # noqa: E402

log = logging.getLogger("bridge")


def load_config(path):
    cfg = configparser.ConfigParser()
    if not cfg.read(path, encoding="utf-8"):
        sys.exit(f"Config file not found: {path} (copy config.example.ini to config.ini)")
    s = cfg["bridge"]
    return {
        "tally_url": s.get("tally_url", "http://localhost:9000"),
        "company": s.get("company", "").strip() or None,
        "website_url": s.get("website_url", "").rstrip("/"),
        "token": s.get("token", ""),
        "days_back": s.getint("days_back", 120),
        "days_ahead": s.getint("days_ahead", 60),
        # Tally looks through every voucher for each request, so a request costs ~30 s
        # however few days it covers: fewer, longer requests are much quicker.
        "days_per_request": s.getint("days_per_request", 31),
        "timeout": s.getint("timeout", 300),
        "every_minutes": s.getint("every_minutes", 10),
        "minutes_per_round": s.getint("minutes_per_round", 7),
        "quick_days_back": s.getint("quick_days_back", 10),
        "full_sync_hour": s.getint("full_sync_hour", 2),
        # Writing new orders into Tally: off unless allow_writes = yes, and then only into
        # write_company (a test copy of the company first).
        "allow_writes": s.getboolean("allow_writes", False),
        "write_company": s.get("write_company", "").strip(),
        "sales_ledger": s.get("sales_ledger", "Sale Central 5%"),
        "gst_registration": s.get("gst_registration", "Uttar Pradesh Registration"),
        "company_gstin": s.get("company_gstin", "09ABHCS0526J1Z7"),
        "state_file": os.path.join(os.path.dirname(os.path.abspath(path)), "state.json"),
    }


# --- reading Tally ---------------------------------------------------------------

# Some TallyPrime builds answer the rich field list with nothing; the first list
# that returns data is used from then on.
_variants = list(tally.FETCH_VARIANTS)


def voucher_types(cfg):
    try:
        base = tally.resolve_base_types(
            tally.post(cfg["tally_url"], tally.voucher_types_request(cfg["company"]), cfg["timeout"]))
    except tally.TallyError as e:
        if "Could not reach" in str(e):
            raise
        base = {}
    if not any(b in tally.ORDER_BASES for b in base.values()):
        log.warning("Tally didn't list its voucher types; using the built-in names only")
        base = dict(tally.DEFAULT_TYPES)
    wanted = {n for n, b in base.items() if b in tally.ORDER_BASES | tally.FULFIL_BASES}
    return base, wanted


def read_chunk(cfg, types, start, stop):
    global _variants
    base, wanted = types
    for variant in _variants:
        root = tally.post(cfg["tally_url"], tally.vouchers_request(wanted, start, stop, cfg["company"], variant),
                          cfg["timeout"])
        o, f = tally.parse_vouchers(root, base)
        if o or f:
            if len(_variants) > 1:
                log.info("Tally answers the '%s' field list; using it from now on", variant)
                _variants = [variant]
            break
    return o, f


def chunks(cfg, start, end):
    """A month at a time, as very large requests can time out on a busy Tally."""
    while start <= end:
        stop = min(start + dt.timedelta(days=cfg["days_per_request"] - 1), end)
        yield start, stop
        start = stop + dt.timedelta(days=1)


def read_tally(cfg, start, end, types=None):
    types = types or voucher_types(cfg)
    orders, fulfilments = [], []
    for s, e in chunks(cfg, start, end):
        o, f = read_chunk(cfg, types, s, e)
        orders += o
        fulfilments += f
    return orders, fulfilments


def window(cfg, full):
    """Full sync: the whole period the website shows. Quick sync: just the last few days,
    which is where new orders, edits and deliveries against any order land."""
    today = dt.date.today()
    back = cfg["days_back"] if full else cfg["quick_days_back"]
    return today - dt.timedelta(days=back), today + dt.timedelta(days=cfg["days_ahead"])


# --- talking to the website ------------------------------------------------------

def now_iso():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def send(cfg, message):
    payload = gzip.compress(json.dumps({"synced_at": now_iso(), **message}).encode("utf-8"))
    req = urllib.request.Request(
        cfg["website_url"] + "/api/sync",
        data=payload,
        headers={"Content-Type": "application/json", "Content-Encoding": "gzip",
                 "Authorization": f'Bearer {cfg["token"]}'},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())


def send_window(cfg, orders, fulfilments, start, end):
    """Replace one period on the website with what Tally has now."""
    return send(cfg, {"full": False, "from": start.isoformat(), "to": end.isoformat(),
                      "orders": orders, "fulfilments": fulfilments})


def bridge_call(cfg, path, body=None):
    """The website's /api/bridge endpoints: masters for the order form, and new orders."""
    req = urllib.request.Request(
        cfg["website_url"] + "/api/bridge/" + path,
        data=None if body is None else json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f'Bearer {cfg["token"]}'},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())


def read_masters(cfg, company):
    """Customers (ledgers under Sundry Debtors) and stock items, for the order form."""
    def get(kind, fields):
        return tally.post(cfg["tally_url"], tally.masters_request(kind, fields, company), cfg["timeout"])
    customers = tally.parse_customers(get("Group", ["Name", "Parent"]),
                                      get("Ledger", ["Name", "Parent", "PartyGSTIN"]))
    items = tally.parse_items(get("StockItem", ["Name", "BaseUnits"]))
    return customers, items


def send_masters(cfg):
    customers, items = read_masters(cfg, cfg["company"])
    if not customers or not items:
        log.warning("Tally listed no customers or items, so the order form keeps its old lists")
        return
    bridge_call(cfg, "masters", {"customers": customers, "items": items})
    log.info("Sent %d customers and %d items for the order form", len(customers), len(items))


def write_orders(cfg):
    """Write approved new orders from the website into Tally, each exactly once."""
    changes = bridge_call(cfg, "changes")
    if not changes:
        return
    if not cfg["allow_writes"] or not cfg["write_company"]:
        log.info("%d approved order(s) are waiting; writing is switched off in config.ini", len(changes))
        return
    company = cfg["write_company"]
    if company not in tally.open_companies(tally.post(cfg["tally_url"], tally.companies_request(), cfg["timeout"])):
        log.warning("%r is not open in Tally, so %d approved order(s) wait", company, len(changes))
        return
    customers, items = read_masters(cfg, company)
    gstins = {c["name"]: c["gstin"] for c in customers}
    items = {i["name"] for i in items}
    for ch in changes:
        order, cid = ch["order"], ch["id"]
        missing = writer.check_masters(order, gstins, items)
        if missing:
            bridge_call(cfg, f"changes/{cid}", {"status": "failed", "error": (
                f"Not in Tally ({company}): {', '.join(missing)}. Nothing was sent; Tally would "
                "have created these as new masters.")})
            continue
        try:
            xml = writer.build_sales_order(order, company, cfg, gstins[order["party"]])
        except (writer.Refused, KeyError, ValueError) as e:
            bridge_call(cfg, f"changes/{cid}", {"status": "failed", "error": f"Not sent: {e}"})
            continue
        # Marked as being sent first, so it can never be picked up and sent twice.
        bridge_call(cfg, f"changes/{cid}", {"status": "sending"})
        ok, error, _ = writer.send_once(cfg["tally_url"], xml, cfg["timeout"])
        bridge_call(cfg, f"changes/{cid}", {"status": "done"} if ok else {"status": "failed", "error": error})
        log.info("Order %s for %s: %s", order["order_no"], order["party"], "written into Tally" if ok else error)


def load_state(cfg):
    try:
        with open(cfg["state_file"], encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(cfg, state):
    tmp = cfg["state_file"] + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, cfg["state_file"])


def quick_sync(cfg, types):
    start, end = window(cfg, full=False)
    started = time.monotonic()
    orders, fulfilments = read_chunk(cfg, types, start, end)  # one request
    log.info("Quick sync %s..%s: read %d orders, %d delivery lines in %.0f s",
             start, end, len(orders), len(fulfilments), time.monotonic() - started)
    if not orders and not fulfilments:
        # Never blank out recent days because of one empty read (Tally busy, wrong company...).
        log.warning("Tally returned nothing for recent days, so they were left unchanged")
        return send(cfg, {"status_only": True})
    result = send_window(cfg, orders, fulfilments, start, end)
    log.info("Website accepted: %s", result)
    return result


def run_round(cfg, minutes=None):
    """Quick sync, then carry the full copy on from where it got to, for up to `minutes`."""
    started = time.monotonic()
    state = load_state(cfg)
    types = voucher_types(cfg)
    site = quick_sync(cfg, types)
    for step, needed in ((send_masters, site.get("masters_stale")), (write_orders, site.get("changes_waiting"))):
        if needed:
            try:
                step(cfg)
            except (tally.TallyError, OSError, ValueError) as e:
                log.error("%s failed: %s", step.__name__.replace("_", " ").capitalize(), e)

    full = state.get("full")
    if full and site.get("run") != full["run"]:
        log.info("The website lost the part-sent full copy (it restarted), so it starts again")
        full = None
    now = dt.datetime.now()
    last = state.get("last_full")
    due = (not last or not site.get("has_full")
           or (last < now.date().isoformat() and now.hour >= cfg["full_sync_hour"]))
    if not full and due:
        start, end = window(cfg, full=True)
        full = {"run": dt.datetime.now().isoformat(), "from": start.isoformat(), "to": end.isoformat(),
                "next": start.isoformat(), "orders": 0}
        send(cfg, {"start_full": True, "run": full["run"]})
        log.info("Starting a full copy of %s..%s, a month at a time", start, end)
    state["full"] = full
    save_state(cfg, state)

    while full:
        if minutes is not None and time.monotonic() - started > minutes * 60:
            log.info("Full copy has reached %s; the next round carries on from there", full["next"])
            return
        start, end = dt.date.fromisoformat(full["next"]), dt.date.fromisoformat(full["to"])
        if start > end:
            if not full["orders"]:
                log.warning("The full read found no orders at all, so the website was left unchanged")
            else:
                r = send(cfg, {"complete": True, "run": full["run"], "from": full["from"], "to": full["to"]})
                if r.get("run") != full["run"]:
                    log.info("The website lost the part-sent full copy (it restarted), so it starts again")
                    state.pop("full")
                    save_state(cfg, state)
                    return
                log.info("Full copy finished: %d orders on the website", full["orders"])
            state["last_full"] = now.date().isoformat()
            state.pop("full")
            save_state(cfg, state)
            return
        stop = min(start + dt.timedelta(days=cfg["days_per_request"] - 1), end)
        orders, fulfilments = read_chunk(cfg, types, start, stop)
        if orders or fulfilments:
            send_window(cfg, orders, fulfilments, start, stop)
        log.info("Full copy: %s..%s done (%d orders, %d delivery lines)", start, stop, len(orders), len(fulfilments))
        full["orders"] += len(orders)
        full["next"] = (stop + dt.timedelta(days=1)).isoformat()
        save_state(cfg, state)


def dry_run(cfg, full):
    started = time.monotonic()
    start, end = window(cfg, full)
    orders, fulfilments = read_tally(cfg, start, end)
    sales = sum(1 for o in orders if o["kind"] == "sales")
    log.info("Read %s..%s: %d sales orders, %d purchase orders, %d delivery lines in %.0f s",
             start, end, sales, len(orders) - sales, len(fulfilments), time.monotonic() - started)
    for o in orders[:3]:
        print(f'{o["date"]}  {o["voucher_type"]} {o["number"]}  {o["party"]}  Rs {o["total"]:,.2f}'
              f'  ({len(o["lines"])} item/size lines)')


# --- running -----------------------------------------------------------------------

def take_lock(cfg):
    """Only one round at a time, whether started by hand or by Windows."""
    path = cfg["state_file"] + ".lock"
    try:
        if time.time() - os.path.getmtime(path) > 30 * 60:
            os.remove(path)  # left behind by a round that was killed
    except OSError:
        pass
    try:
        os.close(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        return path
    except FileExistsError:
        return None


def setup_logging(cfg):
    handlers = [logging.handlers.RotatingFileHandler(os.path.join(os.path.dirname(cfg["state_file"]), "bridge.log"),
                                                     maxBytes=1_000_000, backupCount=2, encoding="utf-8")]
    if sys.stderr:  # pythonw (used by the Windows task) has no console
        handlers.append(logging.StreamHandler())
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=handlers)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(HERE, "config.ini"))
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--quick", action="store_true", help="with --dry-run: only the last few days")
    args = ap.parse_args()
    cfg = load_config(args.config)
    setup_logging(cfg)
    if args.dry_run:
        try:
            dry_run(cfg, full=not args.quick)
        except tally.TallyError as e:
            sys.exit(f"Problem: {e}")
        return
    if not (cfg["website_url"] and cfg["token"]):
        sys.exit("Set website_url and token in config.ini")

    lock = take_lock(cfg)
    if not lock:
        log.info("Another round is already running, so this one stops here")
        return
    try:
        while True:
            ok = False
            try:
                run_round(cfg, cfg["minutes_per_round"])
                ok = True
            except tally.TallyError as e:
                log.error("Problem: %s", e)
            except OSError as e:  # keep going; the website may be waking up, or the line dropped
                log.error("Could not reach the website at %s (%s); progress so far is kept",
                          cfg["website_url"], getattr(e, "reason", e))
            except Exception:
                log.exception("Round failed")
            if args.once:
                sys.exit(0 if ok else 1)
            os.utime(lock)
            time.sleep(cfg["every_minutes"] * 60)
            os.utime(lock)
    finally:
        os.remove(lock)


if __name__ == "__main__":
    main()
