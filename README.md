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

SNJ's Tally is hosted by tallyprimecloud.in and staff only see a locked-down window,
so this is done by whoever installed the existing `tally_bridge` (Frappe) program,
the same way. The two programs run side by side; this one never writes to Tally.

1. Tally already acts as a server on port 9000 (the Frappe bridge uses it). Do **not**
   open port 9000 in the server's firewall.
2. Python is already on the server (`C:\Program Files\Python314\python.exe`).
3. Copy the `bridge` folder to `C:\snj-orders\bridge`, copy `config.example.ini` to
   `config.ini`. The company name is already filled in.
4. Test without sending anything, in Command Prompt:
   ```
   cd C:\snj-orders\bridge
   python bridge.py --dry-run
   ```
   It prints how many orders it read and the first three. Send that output back.
5. Once the website is online, put its address and token in `config.ini` and run
   `python bridge.py --once`, then check the website.
6. Keep it running: in Windows **Task Scheduler**, create a task "At startup" that runs
   `python C:\snj-orders\bridge\bridge.py` (it syncs every 15 minutes by default).

The bridge asks Tally for one week at a time, and tries a smaller field list if
Tally answers the full one with nothing (some TallyPrime builds do that). If a read
comes back empty, the website keeps its last copy rather than going blank.

## How "sent / left" is worked out

SNJ keeps sizes as Tally batches, so every order line is an item and a size. Tally links
deliveries to orders through the **Order No.** on each invoice, delivery note, purchase or
receipt note batch line. The bridge collects those, and the website subtracts them from each
item and size. Orders older than `days_back` (default 120 days) are not copied.

## Tests

```bash
pip install -r requirements.txt pytest httpx
python -m pytest tests
```

The tests use `tests/fake_tally.py`, a stand-in for Tally's port with sample orders.
