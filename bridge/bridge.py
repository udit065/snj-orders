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
    }


def read_tally(cfg):
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
    today = dt.date.today()
    start = today - dt.timedelta(days=cfg["days_back"])
    end = today + dt.timedelta(days=cfg["days_ahead"])
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


def send(cfg, orders, fulfilments):
    payload = json.dumps({
        "synced_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "orders": orders,
        "fulfilments": fulfilments,
    }).encode("utf-8")
    req = urllib.request.Request(
        cfg["website_url"] + "/api/sync",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f'Bearer {cfg["token"]}'},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def sync_once(cfg, dry_run=False):
    orders, fulfilments = read_tally(cfg)
    sales = sum(1 for o in orders if o["kind"] == "sales")
    log.info("Read %d sales orders, %d purchase orders, %d delivery lines from Tally",
             sales, len(orders) - sales, len(fulfilments))
    if dry_run:
        for o in orders[:3]:
            sizes = len(o["lines"])
            print(f'{o["date"]}  {o["voucher_type"]} {o["number"]}  {o["party"]}  Rs {o["total"]:,.2f}  ({sizes} item/size lines)')
        return
    if not orders:
        # Never wipe the website because of one empty read (Tally busy, wrong company...).
        log.warning("Tally returned no orders, so the website was left unchanged")
        return
    result = send(cfg, orders, fulfilments)
    log.info("Website accepted: %s", result)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.ini"))
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = load_config(args.config)
    if not args.dry_run and not (cfg["website_url"] and cfg["token"]):
        sys.exit("Set website_url and token in config.ini")

    if args.once or args.dry_run:
        try:
            sync_once(cfg, args.dry_run)
        except tally.TallyError as e:
            sys.exit(f"Problem: {e}")
        return
    while True:
        try:
            sync_once(cfg)
        except Exception as e:  # keep running; Tally may just be closed for a moment
            log.error("Sync failed: %s", e)
        time.sleep(cfg["every_minutes"] * 60)


if __name__ == "__main__":
    main()
