// SNJ Orders website: the API for the React pages, and the bridge's /api/sync.
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cookieSession = require("cookie-session");
const db = require("./db");
const { staffRoutes, bridgeRoutes, bridgeHints } = require("./changes");
const { STATUS_LABEL, withProgress, statusOf, groupByItem, listOrders, refreshProgress } = require("./orders");
const portal = require("./portal");

function createApp({ bridgeToken = "", sessionSecret, httpsOnly = false } = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cookieSession({
    name: "snj", keys: [sessionSecret || crypto.randomBytes(32).toString("hex")],
    maxAge: 12 * 3600 * 1000, secure: httpsOnly, sameSite: "lax", httpOnly: true,
  }));

  // Each request re-reads the login, so a switched-off login or changed customers apply at once.
  const requireLogin = async (req, res, next) => {
    const u = req.session.user && await db.User.findOne({ username: req.session.user.username, active: true }).lean();
    if (!u) {
      req.session = null;
      return res.status(401).json({ detail: "Please sign in." });
    }
    req.user = { username: u.username, name: u.name || u.username, role: u.role || "staff", parties: u.parties || [] };
    next();
  };
  const requireStaff = (req, res, next) => (req.user.role === "staff" ? next()
    : res.status(403).json({ detail: "This page is for SNJ staff." }));
  const synced = async () => ({ synced_at: await db.getMeta("synced_at") });
  const requireBridge = (req, res, next) => {
    const auth = Buffer.from(req.get("authorization") || "");
    const want = Buffer.from(`Bearer ${bridgeToken}`);
    if (!bridgeToken || auth.length !== want.length || !crypto.timingSafeEqual(auth, want)) {
      return res.status(401).json({ detail: "Bad bridge token" });
    }
    next();
  };

  app.post("/api/login", express.json(), async (req, res) => {
    const { username = "", password = "" } = req.body || {};
    const user = await db.authenticate(username, password);
    if (!user) return res.status(401).json({ detail: "Wrong username or password." });
    req.session.user = { username: user.username };
    res.json({ user: { username: user.username, name: user.name || user.username, role: user.role || "staff" } });
  });

  app.post("/api/logout", (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  app.get("/api/me", requireLogin, async (req, res) => {
    res.json({ user: req.user, ...(await synced()) });
  });

  app.get("/api/orders/:kind", requireLogin, requireStaff, async (req, res) => {
    const { kind } = req.params;
    if (!["sales", "purchase"].includes(kind)) return res.status(404).json({ detail: "Page not found." });
    res.json({ ...(await listOrders(kind, req.query)), ...(await synced()) });
  });

  app.get("/api/order/:guid", requireLogin, async (req, res) => {
    const order = await db.Order.findOne({ guid: req.params.guid }).lean();
    // A distributor sees only their own sales orders; anything else looks like it doesn't exist.
    const own = (o) => req.user.role === "staff" || (o.kind === "sales" && req.user.parties.includes(o.party));
    if (!order || !own(order)) {
      return res.status(404).json({ detail: "This order is no longer in Tally, or is older than the sync window." });
    }
    const lines = (await withProgress([order], { kind: order.kind, party: order.party })).get(order.guid);
    const orderNos = [...new Set(lines.map((l) => l.order_no))];
    const history = await db.Fulfilment.find({ kind: order.kind, party: order.party, order_no: { $in: orderNos } })
      .sort({ date: 1, voucher: 1, item: 1, size: 1 }).lean();
    const st = order.cancelled ? "cancelled" : statusOf(lines);
    const { lines: _, _id, __v, ...rest } = order;
    res.json({
      order: { ...rest, status: st, status_label: STATUS_LABEL[st] },
      items: groupByItem(lines),
      history: history.map(({ date, voucher, item, size, qty }) => ({ date, voucher, item, size, qty })),
      ...(await synced()),
    });
  });

  // --- bridge endpoint: same messages as the Python website, so the bridge doesn't change ---
  app.post("/api/sync", requireBridge, express.raw({ type: () => true, limit: "300mb" }), async (req, res) => {
    const data = JSON.parse(req.body.toString("utf8"));  // gzip is undone by express.raw
    // A full copy comes a month at a time: "start_full", then the months, then "complete".
    if (data.start_full) {
      await db.setMeta("full_run", data.run);
    } else if (data.complete) {
      if (data.run === (await db.getMeta("full_run"))) {
        await db.finishFull(data.from, data.to, data.synced_at);
        await refreshProgress();
      }
    } else if (data.orders) {
      const parties = data.full === false
        ? await db.replaceAll(data.orders, data.fulfilments, data.synced_at, data.from, data.to)
        : await db.replaceAll(data.orders, data.fulfilments, data.synced_at);
      await refreshProgress(parties);
    }
    res.json({ orders: (data.orders || []).length, fulfilments: (data.fulfilments || []).length,
               has_full: await db.hasFull(), run: await db.getMeta("full_run"), ...(await bridgeHints()) });
  });

  app.use("/api/bridge", bridgeRoutes({ requireBridge }));
  app.use("/api", portal.routes({ requireLogin, requireStaff }));
  app.use("/api", staffRoutes({ requireLogin, requireStaff }));

  app.use("/api", (req, res) => res.status(404).json({ detail: "Page not found." }));

  // The React pages, built into client/dist.
  const dist = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(dist));
  app.get("/{*path}", (req, res) => res.sendFile(path.join(dist, "index.html")));

  app.use((err, req, res, next) => {  // eslint-disable-line no-unused-vars
    console.error(err);
    res.status(err.status || 500).json({ detail: err.expose ? err.message : "Something went wrong." });
  });
  return app;
}

module.exports = { createApp };
