# SNJ Orders

A private, **view-only** website where office staff can see SN Jain Industries' sales and purchase orders
from Tally Prime: what was ordered, what has been sent or received, what is still left, and what is overdue.

It has two parts:

| Part | Runs on | Does |
|------|---------|------|
| `bridge/` | The Tally server (Windows, next to Tally) | Every few minutes, **reads** orders from Tally on `localhost:9000` and sends them to the website. It only sends Tally *Export* requests, so it cannot change anything in Tally. |
| `web/` | Any small hosting server | Shows the orders to logged-in staff. |

The bridge only makes outgoing connections, so no port is opened on the Tally server.
It runs alongside the existing Frappe connection without touching it.

## 1. Set up the website

```bash
pip install -r requirements.txt
cd web
python manage.py add-user sidharth "Sidharth Yadav"     # repeat for each staff member
export BRIDGE_TOKEN=<long random secret>                # same value goes in the bridge config
export SECRET_KEY=<another long random secret>
export HTTPS_ONLY=1
uvicorn app:app --host 0.0.0.0 --port 8000              # put it behind HTTPS
```

Make a secret with `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

## 2. Set up the bridge on the Tally server

1. In Tally, check that it acts as a **Server** on port **9000**
   (**F1 Help → Settings → Connectivity → Client/Server configuration**; Tally's help also lists it under
   **Exchange → Data Synchronization**). If the Frappe connection already works, this is already on.
   Do **not** open port 9000 in the server's firewall.
2. Install Python 3 for Windows (python.org, tick "Add to PATH").
3. Copy the `bridge` folder to the server, copy `config.example.ini` to `config.ini`, and fill it in.
4. Test without sending anything: `python bridge.py --dry-run`. It prints the first few orders it read.
5. Send once: `python bridge.py --once`, then check the website.
6. Keep it running: in Windows **Task Scheduler**, create a task "At startup" that runs
   `python C:\snj-orders\bridge\bridge.py` (it syncs every 5 minutes by default).

Tally must be open with the company loaded for the bridge to read it. If Tally is closed, the bridge
logs an error and tries again next round; the website keeps showing the last copy and its time.

## How "sent / left" is worked out

Tally links deliveries to orders through the **Order No.** on each invoice, delivery note, purchase or
receipt note line. The bridge collects those lines, and the website subtracts them from each order line.
Orders older than `days_back` (default 365 days) are not copied.

## Tests

```bash
pip install -r requirements.txt pytest httpx
python -m pytest tests
```

The tests use `tests/fake_tally.py`, a stand-in for Tally's port with sample orders.
