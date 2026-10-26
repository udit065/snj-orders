// Orders with what has been sent against them: shared by the staff pages and the distributor portal.
const db = require("./db");

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
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

// Works out each order's status, next due date and item count from its deliveries and
// saves them on the order. `parties` limits it to those parties (null: every order).
async function refreshProgress(parties = null) {
  const now = Date.now();
  let count = 0;
  for (const kind of ["sales", "purchase"]) {
    const match = { kind, ...(parties ? { party: { $in: parties } } : {}) };
    const orders = await db.Order.find(match, { guid: 1, kind: 1, party: 1, cancelled: 1, lines: 1 }).lean();
    if (!orders.length) continue;
    const progress = await withProgress(orders, match);
    const writes = orders.map((o) => {
      const lines = progress.get(o.guid) || [];
      const dues = lines.filter((l) => l.due_date && l.left > 0).map((l) => l.due_date).sort();
      return { updateOne: { filter: { guid: o.guid }, update: { $set: {
        status: o.cancelled ? "cancelled" : statusOf(lines), next_due: dues[0] || "",
        items_count: new Set(lines.map((l) => l.item)).size,
      } } } };
    });
    for (let i = 0; i < writes.length; i += 1000) await db.Order.bulkWrite(writes.slice(i, i + 1000), { ordered: false });
    count += orders.length;
  }
  return { orders: count, ms: Date.now() - now };
}

const STATUS_FILTER = { open: { $in: ["pending", "partly"] }, pending: "pending", partly: "partly", done: "done",
                        cancelled: "cancelled" };

// One page of an order list, with counts by status. `scope` narrows it (a distributor's own parties).
// Status comes from refreshProgress, so filtering and paging happen inside MongoDB.
async function listOrders(kind, query, scope = {}) {
  const { q = "", status = "open" } = query;
  let [dateFrom, dateTo] = [query.date_from, query.date_to].map((d) => (isDate(d) ? d : ""));
  if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  const perPage = Math.min(200, Math.max(10, parseInt(query.per_page, 10) || 50));
  const filter = { kind, ...scope };
  // Every word must appear somewhere: "niker 38" finds "NIKER S-XL - 38".
  const words = String(q).split(/\s+/).filter(Boolean);
  if (words.length) {
    filter.$and = words.map((w) => {
      const re = new RegExp(escapeRegex(w), "i");
      return { $or: [{ party: re }, { number: re }, { reference: re }, { "lines.item": re }] };
    });
  }
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = dateFrom;
    if (dateTo) filter.date.$lte = dateTo;
  }
  const counts = { pending: 0, partly: 0, done: 0, cancelled: 0 };
  for (const c of await db.Order.aggregate([{ $match: filter }, { $group: { _id: "$status", n: { $sum: 1 } } }])) {
    if (c._id in counts) counts[c._id] = c.n;
  }
  const shown = status in STATUS_FILTER ? { ...filter, status: STATUS_FILTER[status] } : filter;
  const total = status === "all" ? Object.values(counts).reduce((a, b) => a + b, 0)
    : status === "open" ? counts.pending + counts.partly : counts[status] || 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(pages, Math.max(1, parseInt(query.page, 10) || 1));
  const orders = await db.Order.find(shown, { lines: 0 }).sort({ date: -1, number: -1 })
    .skip((page - 1) * perPage).limit(perPage).lean();
  const now = today();
  const rows = orders.map((o) => ({
    guid: o.guid, date: o.date, number: o.number, party: o.party, total: o.total, optional: o.optional,
    items: o.items_count || 0, next_due: o.next_due || "",
    overdue: !!(o.next_due && o.next_due < now && o.status !== "cancelled"),
    status: o.status, status_label: STATUS_LABEL[o.status] || "",
  }));
  return { orders: rows, counts, total, page, pages, per_page: perPage, date_from: dateFrom, date_to: dateTo };
}

module.exports = { STATUS_LABEL, today, withProgress, statusOf, groupByItem, listOrders, refreshProgress };
