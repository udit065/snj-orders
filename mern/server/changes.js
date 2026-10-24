// New orders entered on the website: the form's lists, approval, and the bridge's queue.
const express = require("express");
const db = require("./db");

const STATUS_LABEL = {
  to_approve: "Waiting for approval", approved: "Approved, waiting for Tally", sending: "Being written to Tally",
  done: "In Tally", failed: "Failed", rejected: "Rejected", withdrawn: "Withdrawn",
};
// SNJ sells on a 50% then 20% discount chain: the amount is rate x qty x 0.4.
const DISCOUNTS = { "50+20": 0.4, none: 1 };
const MASTERS_MAX_AGE = 6 * 3600 * 1000;

const round2 = (n) => Math.round(n * 100) / 100;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(s));

function orderTotal(order) {
  return round2(order.lines.reduce((t, l) => t + l.sizes.reduce(
    (u, s) => u + round2(l.rate * s.qty * DISCOUNTS[l.discount]), 0), 0));
}

// Checks a new order against Tally's lists; returns [clean order, problems].
async function checkOrder(input) {
  const problems = [];
  const masters = await db.Masters.findById("tally").lean();
  if (!masters) return [null, ["The customer and item lists haven't arrived from Tally yet."]];
  const customers = new Set(masters.customers.map((c) => c.name));
  const units = new Map(masters.items.map((i) => [i.name, i.unit]));
  const text = (v) => String(v ?? "").trim();
  const order = {
    order_no: text(input.order_no), date: text(input.date), party: text(input.party),
    reference: text(input.reference), narration: text(input.narration), lines: [],
  };
  if (!order.order_no) problems.push("Enter the order number.");
  if (!isDate(order.date)) problems.push("Enter the order date.");
  if (!customers.has(order.party)) problems.push(`Pick the customer from the list ("${order.party}" isn't in Tally).`);
  for (const [i, l] of (Array.isArray(input.lines) ? input.lines : []).entries()) {
    const n = i + 1;
    const line = { item: text(l.item), rate: Number(l.rate), discount: text(l.discount) || "50+20", sizes: [] };
    if (!units.has(line.item)) problems.push(`Line ${n}: pick the item from the list.`);
    line.unit = units.get(line.item) || "";
    if (!(line.rate > 0)) problems.push(`Line ${n}: enter a rate (Tally refuses orders without one).`);
    if (!(line.discount in DISCOUNTS)) problems.push(`Line ${n}: unknown discount.`);
    for (const s of Array.isArray(l.sizes) ? l.sizes : []) {
      const size = { size: text(s.size), qty: Number(s.qty), due_date: text(s.due_date) };
      if (!(size.qty > 0)) problems.push(`Line ${n}: every size needs a quantity.`);
      if (!isDate(size.due_date)) problems.push(`Line ${n}: every size needs a due date.`);
      line.sizes.push(size);
    }
    if (!line.sizes.length) problems.push(`Line ${n}: add at least one size.`);
    order.lines.push(line);
  }
  if (!order.lines.length) problems.push("Add at least one item.");
  if (order.order_no) {
    const taken = await db.Order.exists({ number: order.order_no })
      || await db.Change.exists({ "order.order_no": order.order_no, status: { $nin: ["rejected", "withdrawn", "failed"] } });
    if (taken) problems.push(`Order number ${order.order_no} is already used.`);
  }
  return [order, [...new Set(problems)]];
}

function view(c) {
  return {
    id: String(c._id), status: c.status, status_label: STATUS_LABEL[c.status], order: c.order, total: c.total,
    created_by: c.created_by, created_at: c.createdAt, error: c.error || "", history: c.history,
  };
}

// Moves a change on, only from the statuses given; returns null if it had already moved.
async function move(id, from, status, by, extra = {}) {
  const note = extra.error || "";
  const c = await db.Change.findOneAndUpdate(
    { _id: id, status: { $in: from } },
    { status, ...extra, $push: { history: { at: new Date(), by, status, note } } },
    { returnDocument: "after" },
  ).lean().catch(() => null);
  return c;
}

function staffRoutes({ requireLogin, approvers }) {
  const r = express.Router();
  r.use(requireLogin);
  const canApprove = (user) => !approvers.length || approvers.includes(user.username);

  r.get("/masters", async (req, res) => {
    const m = await db.Masters.findById("tally").lean();
    res.json(m ? { customers: m.customers, items: m.items, updated_at: m.updated_at }
               : { customers: [], items: [], updated_at: null });
  });

  r.post("/changes", express.json({ limit: "1mb" }), async (req, res) => {
    const [order, problems] = await checkOrder(req.body || {});
    if (problems.length) return res.status(400).json({ detail: problems.join(" "), problems });
    const by = req.session.user.username;
    const c = await db.Change.create({
      status: "to_approve", order, total: orderTotal(order), created_by: by,
      history: [{ at: new Date(), by, status: "to_approve", note: "" }],
    });
    res.json(view(c.toObject()));
  });

  r.get("/changes", async (req, res) => {
    const list = await db.Change.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json({ changes: list.map(view), can_approve: canApprove(req.session.user) });
  });

  const action = (from, status, allowed) => async (req, res) => {
    const user = req.session.user;
    const c = await db.Change.findById(req.params.id).lean().catch(() => null);
    if (!c) return res.status(404).json({ detail: "No such order." });
    if (!allowed(user, c)) return res.status(403).json({ detail: "You can't do that." });
    const moved = await move(c._id, from, status, user.username);
    if (!moved) return res.status(409).json({ detail: `It is already ${STATUS_LABEL[c.status].toLowerCase()}.` });
    res.json(view(moved));
  };
  r.post("/changes/:id/approve", action(["to_approve"], "approved", (u) => canApprove(u)));
  r.post("/changes/:id/reject", action(["to_approve"], "rejected", (u) => canApprove(u)));
  r.post("/changes/:id/withdraw", action(["to_approve", "approved"], "withdrawn",
    (u, c) => canApprove(u) || c.created_by === u.username));
  return r;
}

function bridgeRoutes({ requireBridge }) {
  const r = express.Router();
  r.use(requireBridge);

  r.post("/masters", express.json({ limit: "50mb" }), async (req, res) => {
    const { customers = [], items = [] } = req.body || {};
    await db.Masters.updateOne({ _id: "tally" }, { customers, items, updated_at: new Date() }, { upsert: true });
    res.json({ customers: customers.length, items: items.length });
  });

  r.get("/changes", async (req, res) => {
    const list = await db.Change.find({ status: "approved" }).sort({ createdAt: 1 }).lean();
    res.json(list.map((c) => ({ id: String(c._id), order: c.order })));
  });

  // sending only from approved, so an order is never sent twice; done/failed after sending.
  const NEXT = { sending: ["approved"], done: ["sending"], failed: ["approved", "sending"] };
  r.post("/changes/:id", express.json(), async (req, res) => {
    const { status, error = "" } = req.body || {};
    if (!NEXT[status]) return res.status(400).json({ detail: "Unknown status." });
    const moved = await move(req.params.id, NEXT[status], status, "bridge", status === "failed" ? { error } : {});
    if (!moved) return res.status(409).json({ detail: "That order isn't waiting for this step." });
    res.json(view(moved));
  });
  return r;
}

// What the bridge needs to know after each sync.
async function bridgeHints() {
  const m = await db.Masters.findById("tally", { updated_at: 1 }).lean();
  return {
    masters_stale: !m || Date.now() - new Date(m.updated_at).getTime() > MASTERS_MAX_AGE,
    changes_waiting: await db.Change.countDocuments({ status: "approved" }),
  };
}

module.exports = { staffRoutes, bridgeRoutes, bridgeHints, orderTotal, STATUS_LABEL };
