"""SNJ Orders bridge: copies sales and purchase orders from Tally to the website.

Runs on the Tally server. It only ever *reads* from Tally, and only makes
outgoing connections to the website, so no port is opened on the server.

    python bridge.py            # keep syncing every few minutes
    python bridge.py --once     # sync once and exit (good for testing)
    python bridge.py --dry-run  # read Tally and print a summary, send nothing
"""

import argparse
import configparser
import datetime as dt
import gzip
import json
import logging
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tally  # noqa: E402

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
        "chunk_days": s.getint("chunk_days", 7),
        "timeout": s.getint("timeout", 300),
        "every_minutes": s.getint("every_minutes", 15),
        "quick_days_back": s.getint("quick_days_back", 10),
        "full_sync_hour": s.getint("full_sync_hour", 2),
    }


def read_tally(cfg, start, end):
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

    # Ask for a week at a time, as large requests can time out on a busy Tally.
    orders, fulfilments = [], []
    variants = list(tally.FETCH_VARIANTS)
    while start <= end:
        stop = min(start + dt.timedelta(days=cfg["chunk_days"] - 1), end)
        for variant in variants:
            root = tally.post(cfg["tally_url"],
                              tally.vouchers_request(wanted, start, stop, cfg["company"], variant),
                              cfg["timeout"])
            o, f = tally.parse_vouchers(root, base)
            if o or f:
                if len(variants) > 1:
                    log.info("Tally answers the '%s' field list; using it from now on", variant)
                    variants = [variant]
                break
        orders += o
        fulfilments += f
        start = stop + dt.timedelta(days=1)
    return orders, fulfilments


def window(cfg, full):
    """Full sync: the whole period the website shows. Quick sync: just the last few days,
    which is where new orders, edits and deliveries against any order land."""
    today = dt.date.today()
    back = cfg["days_back"] if full else cfg["quick_days_back"]
    return today - dt.timedelta(days=back), today + dt.timedelta(days=cfg["days_ahead"])


def send(cfg, orders, fulfilments, start, end, full):
    payload = gzip.compress(json.dumps({
        "synced_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "full": full,
        "from": start.isoformat(),
        "to": end.isoformat(),
        "orders": orders,
        "fulfilments": fulfilments,
    }).encode("utf-8"))
    req = urllib.request.Request(
        cfg["website_url"] + "/api/sync",
        data=payload,
        headers={"Content-Type": "application/json", "Content-Encoding": "gzip",
                 "Authorization": f'Bearer {cfg["token"]}'},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())


def sync_once(cfg, full=True, dry_run=False):
    started = time.monotonic()
    start, end = window(cfg, full)
    orders, fulfilments = read_tally(cfg, start, end)
    sales = sum(1 for o in orders if o["kind"] == "sales")
    log.info("%s sync %s..%s: read %d sales orders, %d purchase orders, %d delivery lines in %.0f s",
             "Full" if full else "Quick", start, end, sales, len(orders) - sales, len(fulfilments),
             time.monotonic() - started)
    if dry_run:
        for o in orders[:3]:
            sizes = len(o["lines"])
            print(f'{o["date"]}  {o["voucher_type"]} {o["number"]}  {o["party"]}  Rs {o["total"]:,.2f}  ({sizes} item/size lines)')
        return
    if not orders and (full or not fulfilments):
        # Never wipe the website because of one empty read (Tally busy, wrong company...).
        log.warning("Tally returned nothing, so the website was left unchanged")
        return
    result = send(cfg, orders, fulfilments, start, end, full)
    log.info("Website accepted: %s", result)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.ini"))
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--quick", action="store_true", help="with --once/--dry-run: only the last few days")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = load_config(args.config)
    if not args.dry_run and not (cfg["website_url"] and cfg["token"]):
        sys.exit("Set website_url and token in config.ini")

    if args.once or args.dry_run:
        try:
            sync_once(cfg, full=not args.quick, dry_run=args.dry_run)
        except tally.TallyError as e:
            sys.exit(f"Problem: {e}")
        return
    # A full read of SNJ's books takes ~12 minutes, so it runs once at start and then
    # nightly; in between, quick syncs pick up the last few days.
    last_full = None
    while True:
        now = dt.datetime.now()
        full = last_full is None or (now.date() > last_full and now.hour >= cfg["full_sync_hour"])
        try:
            result = sync_once(cfg, full=full)
            if full:
                last_full = now.date()
            elif result and result.get("has_full") is False:
                log.info("The website lost its copy (restarted?); a full sync follows")
                last_full = None
        except Exception as e:  # keep running; Tally may just be closed for a moment
            log.error("Sync failed: %s", e)
        time.sleep(cfg["every_minutes"] * 60)


if __name__ == "__main__":
    main()
