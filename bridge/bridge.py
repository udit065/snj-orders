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
        "days_back": s.getint("days_back", 365),
        "every_minutes": s.getint("every_minutes", 5),
    }


def read_tally(cfg):
    types_root = tally.post(cfg["tally_url"], tally.voucher_types_request(cfg["company"]))
    base = tally.resolve_base_types(types_root)
    wanted = {n for n, b in base.items() if b in tally.ORDER_BASES | tally.FULFIL_BASES}
    if not wanted:
        raise tally.TallyError("No order voucher types found in Tally. Is the right company open?")
    to_date = dt.date.today() + dt.timedelta(days=366)  # orders can be dated ahead
    from_date = dt.date.today() - dt.timedelta(days=cfg["days_back"])
    root = tally.post(cfg["tally_url"], tally.vouchers_request(wanted, from_date, to_date, cfg["company"]))
    return tally.parse_vouchers(root, base)


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
        print(json.dumps(orders[:3], indent=2))
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
        sync_once(cfg, args.dry_run)
        return
    while True:
        try:
            sync_once(cfg)
        except Exception as e:  # keep running; Tally may just be closed for a moment
            log.error("Sync failed: %s", e)
        time.sleep(cfg["every_minutes"] * 60)


if __name__ == "__main__":
    main()
