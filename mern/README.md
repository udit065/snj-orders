# SNJ Orders website (MERN)

The same view-only website as `web/` (Python), rebuilt with MongoDB, Express, React and Node.
It takes data from the same bridge (`../bridge`) in the same format, so the bridge doesn't change:
point its `website_url` at this site.

| Folder | What it is |
|--------|------------|
| `server/` | Express + Mongoose. Logins, the API the pages use, and `/api/sync` for the bridge. |
| `client/` | React pages (Vite): login, order lists with filters, one order with sizes and deliveries. |

Data lives in MongoDB, so it survives restarts (unlike the free Render disk the Python site uses).

## Settings (environment variables)

| Name | What |
|------|------|
| `MONGODB_URI` | MongoDB connection string, e.g. from MongoDB Atlas |
| `BRIDGE_TOKEN` | Secret shared with the bridge's `config.ini` (`token = ...`) |
| `SESSION_SECRET` | Long random text that signs the login cookie |
| `STAFF_LOGINS` | `name:password,name2:password2` (passwords of 8+ characters), re-created at every start |
| `HTTPS_ONLY` | `1` when served over HTTPS (Render) |
| `APPROVERS` | Usernames who may approve new orders, e.g. `sidharth,udit` (everyone if not set) |

## New orders (stage 2)

Staff enter a sales order under **New order**: customer and items come from Tally's own
lists (the bridge sends them every 6 hours), with sizes, quantities, due dates, rate and
discount (SNJ's 50% + 20%, or none). It waits under **Entries** until an approver approves
it. The bridge then writes it into Tally once, and Entries shows each step and who took it.

The bridge only writes when its `config.ini` says `allow_writes = yes`, and only into
`write_company` (a test copy of the company first). See `bridge/writer.py` for the
safety checks.

## Host it for free: MongoDB Atlas + Render

1. **MongoDB Atlas** (cloud.mongodb.com): create a free (M0) cluster. Under *Database Access*
   add a database user with a password. Under *Network Access* allow `0.0.0.0/0`
   (Render's free plan has no fixed address). *Connect > Drivers* gives the connection
   string; put the user's password in it and add the database name `snj` before the `?`:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/snj?retryWrites=true&w=majority`
2. **Render**: New > Web Service > this repository, branch `mern`.
   - Root Directory: `mern`
   - Build Command: `npm run build`
   - Start Command: `npm start`
   - Instance type: Free
   - Environment: the variables above (`HTTPS_ONLY=1`; make `BRIDGE_TOKEN` and
     `SESSION_SECRET` with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).
3. On the Tally server, change `website_url` and `token` in the bridge's `config.ini`
   to the new site, and delete `state.json` there so it sends a full copy.

## Run it on your computer

```bash
npm run build                     # installs and builds the pages
MONGODB_URI=mongodb://localhost:27017/snj BRIDGE_TOKEN=dev STAFF_LOGINS=me:password123 npm start
```

For working on the pages, run the server as above on port 8000 and `npm run dev --prefix client`
in another terminal (Vite reloads the pages as you edit; it passes `/api` calls to the server).

## Tests

```bash
cd server && npm install && npm test
```

They start a throwaway MongoDB with `mongodb-memory-server`. `test/fixtures/sample-sync.json` is
what the bridge reads from the fake Tally in `../tests` (remake it with `python3 test/make-sample.py`).
