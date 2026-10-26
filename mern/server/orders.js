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

// One page of an order list, with counts by status. `scope` narrows it (a distributor's own parties).
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
  const orders = await db.Order.find(filter).sort({ date: -1, number: -1 }).lean();
  const progress = await withProgress(orders, { kind, ...scope });
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
  // Status needs every order's deliveries, so the page is cut after working them out.
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const page = Math.min(pages, Math.max(1, parseInt(query.page, 10) || 1));
  return { orders: rows.slice((page - 1) * perPage, page * perPage), counts, total: rows.length,
           page, pages, per_page: perPage, date_from: dateFrom, date_to: dateTo };
}

module.exports = { STATUS_LABEL, today, withProgress, statusOf, groupByItem, listOrders };
