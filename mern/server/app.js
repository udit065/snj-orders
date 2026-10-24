// SNJ Orders website (view only): the API for the React pages, and the bridge's /api/sync.
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cookieSession = require("cookie-session");
const db = require("./db");
const { staffRoutes, bridgeRoutes, bridgeHints } = require("./changes");

const STATUS_LABEL = { pending: "Pending", partly: "Partly done", done: "Completed", cancelled: "Cancelled" };

// Today in India, as YYYY-MM-DD (the server itself runs on UTC).
function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

const keyOf = (r) => JSON.stringify([r.kind, r.party, r.order_no, r.item, r.size]);

// For each order, its lines with ordered / sent / left quantities.
async function withProgress(orders, match) {
  const delivered = new Map();
  const sums = await db.Fulfilment.aggregate([
    { $match: match },
    { $group: { _id: { kind: "$kind", party: "$party", order_no: "$order_no", item: "$item", size: "$size" },
                qty: { $sum: "$qty" } } },
  ]);
  for (const s of sums) delivered.set(keyOf(s._id), s.qty);
  const out = new Map();
  // Same item and size on two lines: deliveries fill them in turn.
  for (const o of [...orders].sort((a, b) => (a.guid < b.guid ? -1 : 1))) {
    out.set(o.guid, o.lines.map((l) => {
      const k = keyOf({ ...l, kind: o.kind, party: o.party });
      const sent = Math.max(0, Math.min(l.qty, delivered.get(k) || 0));
      delivered.set(k, (delivered.get(k) || 0) - sent);
      return { ...l, sent, left: Math.round((l.qty - sent) * 1e4) / 1e4 };
    }));
  }
  return out;
}

function statusOf(lines) {
  const ordered = lines.reduce((t, l) => t + l.qty, 0);
  const sent = lines.reduce((t, l) => t + l.sent, 0);
  if (ordered && sent >= ordered - 1e-9) return "done";
  return sent > 0 ? "partly" : "pending";
}

function groupByItem(lines) {
  const items = new Map();
  for (const l of lines) {
    if (!items.has(l.item)) {
      items.set(l.item, { item: l.item, unit: l.unit, rate: l.rate, qty: 0, sent: 0, left: 0, amount: 0, sizes: [] });
    }
    const g = items.get(l.item);
    for (const k of ["qty", "sent", "left", "amount"]) g[k] = Math.round((g[k] + l[k]) * 1e4) / 1e4;
    g.sizes.push(l);
  }
  return [...items.values()];
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function createApp({ bridgeToken = "", sessionSecret, httpsOnly = false, approvers = [] } = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cookieSession({
    name: "snj", keys: [sessionSecret || crypto.randomBytes(32).toString("hex")],
    maxAge: 12 * 3600 * 1000, secure: httpsOnly, sameSite: "lax", httpOnly: true,
  }));

  const requireLogin = (req, res, next) => (req.session.user ? next() : res.status(401).json({ detail: "Please sign in." }));
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
    req.session.user = { username: user.username, name: user.name || user.username };
    res.json({ user: req.session.user });
  });

  app.post("/api/logout", (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  app.get("/api/me", requireLogin, async (req, res) => {
    const canApprove = !approvers.length || approvers.includes(req.session.user.username);
    res.json({ user: { ...req.session.user, can_approve: canApprove }, ...(await synced()) });
  });

  app.get("/api/orders/:kind", requireLogin, async (req, res) => {
    const { kind } = req.params;
    if (!["sales", "purchase"].includes(kind)) return res.status(404).json({ detail: "Page not found." });
    const { q = "", status = "open", date_from = "", date_to = "" } = req.query;
    const filter = { kind };
    // Every word must appear somewhere: "niker 38" finds "NIKER S-XL - 38".
    const words = String(q).split(/\s+/).filter(Boolean);
    if (words.length) {
      filter.$and = words.map((w) => {
        const re = new RegExp(escapeRegex(w), "i");
        return { $or: [{ party: re }, { number: re }, { reference: re }, { "lines.item": re }] };
      });
    }
    if (date_from || date_to) {
      filter.date = {};
      if (date_from) filter.date.$gte = date_from;
      if (date_to) filter.date.$lte = date_to;
    }
    const orders = await db.Order.find(filter).sort({ date: -1, number: -1 }).lean();
    const progress = await withProgress(orders, { kind });
    const counts = { pending: 0, partly: 0, done: 0, cancelled: 0 };
    const now = today();
    const rows = [];
    for (const o of orders) {
      const lines = progress.get(o.guid) || [];
      const st = o.cancelled ? "cancelled" : statusOf(lines);
      counts[st] += 1;
      const dues = lines.filter((l) => l.due_date && l.left > 0).map((l) => l.due_date).sort();
      const nextDue = dues[0] || "";
      if (status === "all" || status === st || (status === "open" && (st === "pending" || st === "partly"))) {
        rows.push({
          guid: o.guid, date: o.date, number: o.number, party: o.party, total: o.total, optional: o.optional,
          items: new Set(lines.map((l) => l.item)).size, next_due: nextDue,
          overdue: !!(nextDue && nextDue < now && st !== "cancelled"), status: st, status_label: STATUS_LABEL[st],
        });
      }
    }
    res.json({ orders: rows, counts, ...(await synced()) });
  });

  app.get("/api/order/:guid", requireLogin, async (req, res) => {
    const order = await db.Order.findOne({ guid: req.params.guid }).lean();
    if (!order) {
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
      if (data.run === (await db.getMeta("full_run"))) await db.finishFull(data.from, data.to, data.synced_at);
    } else if (data.orders) {
      if (data.full === false) await db.replaceAll(data.orders, data.fulfilments, data.synced_at, data.from, data.to);
      else await db.replaceAll(data.orders, data.fulfilments, data.synced_at);
    }
    res.json({ orders: (data.orders || []).length, fulfilments: (data.fulfilments || []).length,
               has_full: await db.hasFull(), run: await db.getMeta("full_run"), ...(await bridgeHints()) });
  });

  app.use("/api/bridge", bridgeRoutes({ requireBridge }));
  app.use("/api", staffRoutes({ requireLogin, approvers }));

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
