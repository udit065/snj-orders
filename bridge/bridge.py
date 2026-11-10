"""SNJ Orders bridge: copies sales and purchase orders from Tally to the website.

Runs on the Tally server. It only ever *reads* from Tally, and only makes
outgoing connections to the website, so no port is opened on the server.

    python bridge.py --once     # one round: recent days, plus a few minutes of the full copy
    python bridge.py            # keep doing rounds every few minutes
    python bridge.py --dry-run  # read Tally and print a summary, send nothing
    python bridge.py --check-accounts  # read balances, bills and vouchers; print a summary, send nothing

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
import accounts  # noqa: E402
import tally  # noqa: E402
import writer  # noqa: E402

log = logging.getLogger("bridge")


def load_config(path):
    cfg = configparser.ConfigParser(interpolation=None)  # "%" is literal: "Sale Local 5%"
    if not cfg.read(path, encoding="utf-8"):
        raise ValueError(f"config file not found: {path} (copy config.example.ini to config.ini)")
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
        # Sales ledgers: local for customers in the company's own state, central for the rest.
        "sales_ledger_local": s.get("sales_ledger_local", "Sale Local 5%"),
        "sales_ledger_central": s.get("sales_ledger_central", s.get("sales_ledger", "Sale Central 5%")),
        "gst_registration": s.get("gst_registration", "Uttar Pradesh Registration"),
        "company_gstin": s.get("company_gstin", "09ABHCS0526J1Z7"),
        # Balances, bills and payments (read only), for the distributor portal.
        "read_accounts": s.getboolean("read_accounts", True),
        "accounts_every_minutes": s.getint("accounts_every_minutes", 30),
        "accounts_from": s.get("accounts_from", "").strip(),
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
    """The website's /api/bridge endpoints: masters, new orders, accounts."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json", "Authorization": f'Bearer {cfg["token"]}'}
    if data and len(data) > 100_000:
        data = gzip.compress(data)
        headers["Content-Encoding"] = "gzip"
    req = urllib.request.Request(cfg["website_url"] + "/api/bridge/" + path, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())


def read_masters(cfg, company):
    """Customers (ledgers under Sundry Debtors), stock items, and every ledger's name."""
    def get(kind, fields):
        return tally.post(cfg["tally_url"], tally.masters_request(kind, fields, company), cfg["timeout"])
    try:
        ledgers = get("Ledger", ["Name", "Parent", "PartyGSTIN", "LedStateName"])
    except tally.TallyError:  # a build without the state field: GSTIN alone then decides
        ledgers = get("Ledger", ["Name", "Parent", "PartyGSTIN"])
    customers = tally.parse_customers(get("Group", ["Name", "Parent"]), ledgers)
    items = tally.parse_items(get("StockItem", ["Name", "BaseUnits"]))
    return customers, items, tally.ledger_names(ledgers)


def send_masters(cfg):
    customers, items, _ = read_masters(cfg, cfg["company"])
    if not customers or not items:
        log.warning("Tally listed no customers or items, so the order form keeps its old lists")
        return
    bridge_call(cfg, "masters", {"customers": customers, "items": items})
    log.info("Sent %d customers and %d items for the order form", len(customers), len(items))


def write_orders(cfg):
    """Write new orders from the website into Tally, each exactly once."""
    changes = bridge_call(cfg, "changes")
    if not changes:
        return
    if not cfg["allow_writes"] or not cfg["write_company"]:
        log.info("%d new order(s) are waiting; writing is switched off in config.ini", len(changes))
        return
    company = cfg["write_company"]
    open_now = tally.open_companies(tally.post(cfg["tally_url"], tally.companies_request(), cfg["timeout"]))
    if company not in open_now:
        # Naming what Tally does list makes a spelling difference easy to see.
        log.warning("%r is not open in Tally, so %d new order(s) wait. Tally lists these companies as open: %s",
                    company, len(changes), ", ".join(repr(c) for c in open_now) or "none")
        return
    customers, items, ledgers = read_masters(cfg, company)
    customers = {c["name"]: c for c in customers}
    items = {i["name"] for i in items}
    for ch in changes:
        order, cid = ch["order"], ch["id"]
        missing = writer.check_masters(order, customers, items)
        if missing:
            bridge_call(cfg, f"changes/{cid}", {"status": "failed", "error": (
                f"Not in Tally ({company}): {', '.join(missing)}. Nothing was sent; Tally would "
                "have created these as new masters.")})
            continue
        try:
            party = customers[order["party"]]
            xml = writer.build_sales_order(order, company, cfg, party["gstin"], party.get("state", ""), ledgers)
        except (writer.Refused, KeyError, ValueError) as e:
            bridge_call(cfg, f"changes/{cid}", {"status": "failed", "error": f"Not sent: {e}"})
            continue
        # Marked as being sent first, so it can never be picked up and sent twice.
        bridge_call(cfg, f"changes/{cid}", {"status": "sending"})
        ok, error, _ = writer.send_once(cfg["tally_url"], xml, cfg["timeout"])
        bridge_call(cfg, f"changes/{cid}", {"status": "done"} if ok else {"status": "failed", "error": error})
        log.info("Order %s for %s: %s", order["order_no"], order["party"], "written into Tally" if ok else error)


# --- accounts: balances, open bills, invoices, payments (read only) ---------------

_acct_variants = list(accounts.FETCH_VARIANTS)


def read_balances(cfg):
    def get(kind, fields):
        return tally.post(cfg["tally_url"], tally.masters_request(kind, fields, cfg["company"]), cfg["timeout"])
    groups = get("Group", ["Name", "Parent"])
    for fields in accounts.BALANCE_FIELDS:
        try:
            parties = accounts.parse_balances(groups, get("Ledger", fields))
        except tally.TallyError:
            continue
        if parties:
            return parties
    return []


def read_bills(cfg):
    try:
        return accounts.parse_bills(tally.post(cfg["tally_url"], accounts.bills_request(dt.date.today(), cfg["company"]),
                                               cfg["timeout"]))
    except tally.TallyError as e:
        log.warning("Tally's Bills Receivable report didn't come (%s); the website works bills out itself", e)
        return []


def account_types(types):
    base = dict(types[0])
    names = {n for n, b in base.items() if b in accounts.ACCOUNT_BASES}
    if not names:  # Tally didn't list its voucher types: the built-in names
        names = set(accounts.ACCOUNT_BASES)
        base.update({n: n for n in names})
    return base, names


def read_account_chunk(cfg, types, customers, start, stop):
    global _acct_variants
    base, names = types
    entries = []
    for variant in _acct_variants:
        root = tally.post(cfg["tally_url"], accounts.vouchers_request(names, start, stop, cfg["company"], variant),
                          cfg["timeout"])
        entries = accounts.parse_vouchers(root, base, customers)
        if entries:
            if len(_acct_variants) > 1:
                log.info("Tally answers the '%s' account field list; using it from now on", variant)
                _acct_variants = [variant]
            break
    return entries


def send_accounts(cfg, entries, start, stop):
    return bridge_call(cfg, "accounts", {"from": start.isoformat(), "to": stop.isoformat(), "entries": entries})


def sync_accounts(cfg, state, types, deadline, allow_full=True):
    """Balances and open bills every half hour; the last few days' vouchers every round;
    and, a month at a time, every voucher since the start of the financial year."""
    ac = state.setdefault("accounts", {})
    today = dt.date.today()
    if not ac.get("customers") or time.time() - ac.get("balances_at", 0) > cfg["accounts_every_minutes"] * 60:
        parties = read_balances(cfg)
        if not parties:
            log.warning("Tally listed no customer balances, so accounts were left unchanged")
            return
        bills = read_bills(cfg)
        bridge_call(cfg, "balances", {"as_of": today.isoformat(), "parties": parties, "bills": bills,
                                      "bills_source": "tally" if bills else "none"})
        log.info("Sent %d customer balances and %d open bills", len(parties), len(bills))
        ac["customers"] = [p["name"] for p in parties]
        ac["balances_at"] = time.time()
        save_state(cfg, state)
    customers = set(ac["customers"])
    types = account_types(types)

    start = today - dt.timedelta(days=cfg["quick_days_back"])
    entries = read_account_chunk(cfg, types, customers, start, today)
    if entries:
        r = send_accounts(cfg, entries, start, today)
        log.info("Accounts %s..%s: %d entries; %s", start, today, len(entries), r)
    else:
        log.info("No account vouchers for recent days, so they were left unchanged")

    first = (dt.date.fromisoformat(cfg["accounts_from"]) if cfg["accounts_from"] else accounts.fy_start(today))
    never = not ac.get("last_full")
    if not ac.get("next") and (never or (ac["last_full"] < today.isoformat()
                                        and dt.datetime.now().hour >= cfg["full_sync_hour"])):
        ac["next"] = first.isoformat()
        log.info("Starting a full copy of accounts from %s, a month at a time", first)
    while allow_full and ac.get("next") and time.monotonic() < deadline:
        s = dt.date.fromisoformat(ac["next"])
        if s > today:
            ac.pop("next")
            ac["last_full"] = today.isoformat()
            log.info("Full copy of accounts finished")
            break
        e = min(s + dt.timedelta(days=cfg["days_per_request"] - 1), today)
        entries = read_account_chunk(cfg, types, customers, s, e)
        if entries:
            send_accounts(cfg, entries, s, e)
        log.info("Accounts full copy: %s..%s done (%d entries)", s, e, len(entries))
        ac["next"] = (e + dt.timedelta(days=1)).isoformat()
        save_state(cfg, state)
    save_state(cfg, state)


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
    switched = bool(state) and state.get("company") != cfg["company"]
    if switched:
        # Another company: everything on the website is copied again from it, starting now.
        log.info("Company changed from %s to %s, so orders, customers and accounts are copied again now",
                 state.get("company") or "(whichever was open)", cfg["company"] or "(whichever is open)")
        state = {}
    state["company"] = cfg["company"]
    save_state(cfg, state)
    if cfg["company"]:
        asked = time.monotonic()
        open_now = tally.open_companies(tally.post(cfg["tally_url"], tally.companies_request(), cfg["timeout"]))
        log.info("Tally answered in %.0f s; companies open: %s", time.monotonic() - asked,
                 ", ".join(repr(c) for c in open_now) or "none")
        if cfg["company"] not in open_now:
            log.warning("%r is not open in Tally, so nothing was read this round. Open: %s", cfg["company"],
                        ", ".join(repr(c) for c in open_now) or "none")
            return
    types = voucher_types(cfg)
    site = quick_sync(cfg, types)
    if switched:
        site["masters_stale"] = True
    for step, needed in ((send_masters, site.get("masters_stale")), (write_orders, site.get("changes_waiting"))):
        if needed:
            try:
                step(cfg)
            except (tally.TallyError, OSError, ValueError) as e:
                log.error("%s failed: %s", step.__name__.replace("_", " ").capitalize(), e)

    if cfg.get("read_accounts"):
        budget = started + (minutes if minutes is not None else 60) * 60
        try:
            sync_accounts(cfg, state, types, budget, allow_full=not state.get("full"))
        except (tally.TallyError, OSError, ValueError) as e:
            log.error("Accounts failed: %s", e)

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


def check_accounts(cfg):
    """What the accounts part would send, printed instead of sent."""
    started = time.monotonic()
    parties = read_balances(cfg)
    owing = [p for p in parties if p["closing"] > 0]
    print(f"Customers: {len(parties)} ({len(owing)} owe money), total owed Rs {sum(p['closing'] for p in owing):,.2f}")
    for p in sorted(owing, key=lambda p: -p["closing"])[:3]:
        print(f"  {p['name']}: owes Rs {p['closing']:,.2f}, opening Rs {p['opening']:,.2f},"
              f" credit limit {p['credit_limit']}, credit days {p['credit_days']}")
    bills = read_bills(cfg)
    print(f"Open bills (Bills Receivable report): {len(bills)}")
    for b in bills[:3]:
        print(f"  {b['party']}  {b['ref']}  {b['date']}  due {b['due_date']}  Rs {b['amount']:,.2f}")
    today = dt.date.today()
    entries = read_account_chunk(cfg, account_types(voucher_types(cfg)), {p["name"] for p in parties},
                                 today - dt.timedelta(days=30), today)
    kinds = {}
    for e in entries:
        kinds[e["base"]] = kinds.get(e["base"], 0) + 1
    print(f"Vouchers in the last 30 days: {len(entries)} {kinds} (field list: {_acct_variants[0]})")
    for base in sorted(kinds):
        e = next(x for x in entries if x["base"] == base)
        print(f"  {e['date']} {e['voucher_type']} {e['number']}  {e['party']}  Rs {e['amount']:,.2f}"
              f"  bills {[(b['type'], b['ref']) for b in e['bills']][:2]}  transport {e['ship']}")
    print(f"Took {time.monotonic() - started:.0f} s. Nothing was sent.")


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


def setup_logging(folder):
    handlers = [logging.handlers.RotatingFileHandler(os.path.join(folder, "bridge.log"),
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
    ap.add_argument("--check-accounts", action="store_true", help="read balances, bills and vouchers; send nothing")
    args = ap.parse_args()
    # Logging starts first, so a broken config.ini shows up in bridge.log (pythonw has no window).
    setup_logging(os.path.dirname(os.path.abspath(args.config)))
    try:
        cfg = load_config(args.config)
    except (configparser.Error, KeyError, ValueError) as e:
        log.error("config.ini has a problem, so nothing ran: %s", e)
        sys.exit(1)
    if args.check_accounts:
        try:
            check_accounts(cfg)
        except tally.TallyError as e:
            sys.exit(f"Problem: {e}")
        return
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
