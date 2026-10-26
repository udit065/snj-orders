// The distributor portal: a distributor's own orders, order-pad photos and the catalogue,
// and the staff pages that look after them (logins, the photo list, catalogue uploads).
const express = require("express");
const db = require("./db");
const { listOrders, withProgress, statusOf, today } = require("./orders");
const news = require("./news");

const round2 = (n) => Math.round(n * 100) / 100;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_STAGE = { received: "With SNJ, being entered", entered: "Entered, going into Tally",
                      done: "In Tally", rejected: "Not entered" };

// Where each photo has got to, following the order staff entered from it.
async function photoViews(photos) {
  const changes = await db.Change.find({ _id: { $in: photos.map((p) => p.change_id).filter(Boolean) } }).lean();
  const byId = new Map(changes.map((c) => [String(c._id), c]));
  const inTally = await db.Order.find({ kind: "sales", number: { $in: changes.map((c) => c.order.order_no) } },
    { guid: 1, number: 1, party: 1 }).lean();
  return photos.map((p) => {
    const c = p.change_id && byId.get(String(p.change_id));
    let stage = "received";
    if (p.status === "rejected") stage = "rejected";
    else if (c && c.status === "done") stage = "done";
    else if (c && ["waiting", "approved", "to_approve", "sending"].includes(c.status)) stage = "entered";
    // A failed or withdrawn entry goes back to staff, so it shows as received again.
    const order = c && inTally.find((o) => o.number === c.order.order_no && o.party === c.order.party);
    return {
      id: String(p._id), kind: p.kind || "photo", from_order: p.from_order && p.from_order.guid ? p.from_order : null,
      lines: p.lines || [], party: p.party, username: p.username, note: p.note || "", created_at: p.createdAt,
      stage, stage_label: PHOTO_STAGE[stage], staff_note: p.staff_note || "",
      order_no: c ? c.order.order_no : "", order_guid: order ? order.guid : "", total: c ? c.total : null,
      history: p.history,
    };
  });
}

// Customers a distributor login can be linked to: Tally's list, plus anyone with a sales order.
async function partyChoices() {
  const m = await db.Masters.findById("tally", { customers: 1 }).lean();
  const names = new Set([...(m ? m.customers.map((c) => c.name) : []),
                         ...(await db.Order.distinct("party", { kind: "sales" }))]);
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function distributorView(u) {
  return { phone: u.username, name: u.name, parties: u.parties || [], active: u.active !== false,
           created_at: u.createdAt || null };
}

function routes({ requireLogin, requireStaff }) {
  const r = express.Router();
  const requireDistributor = (req, res, next) => (req.user.role === "distributor" ? next()
    : res.status(403).json({ detail: "This page is for distributors." }));
  const distributor = [requireLogin, requireDistributor];
  const staff = [requireLogin, requireStaff];
  const mine = (req) => ({ party: { $in: req.user.parties } });
  const synced = async () => ({ synced_at: await db.getMeta("synced_at") });
  const canSee = (req, party) => req.user.role === "staff" || req.user.parties.includes(party);

  // --- distributors ---

  r.get("/my/home", ...distributor, async (req, res) => {
    const scope = { kind: "sales", ...mine(req) };
    const orders = await db.Order.find({ ...scope, cancelled: { $ne: true } }).lean();
    const progress = await withProgress(orders, scope);
    const now = today();
    let openOrders = 0;
    let valueLeft = 0;
    const coming = [];
    for (const o of orders) {
      const lines = progress.get(o.guid) || [];
      if (statusOf(lines) === "done") continue;
      openOrders += 1;
      for (const l of lines.filter((x) => x.left > 0)) {
        valueLeft += l.qty ? (l.amount * l.left) / l.qty : 0;
        coming.push({ item: l.item, size: l.size, left: l.left, unit: l.unit, due_date: l.due_date,
                      order_no: o.number, order_date: o.date, guid: o.guid, overdue: !!(l.due_date && l.due_date < now) });
      }
    }
    // Soonest first; lines without a due date last.
    coming.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || a.order_date.localeCompare(b.order_date));
    const photos = await db.OrderPhoto.find(mine(req)).sort({ createdAt: -1 }).limit(3).lean();
    const recent = await listOrders("sales", { status: "all", per_page: 10 }, mine(req));
    res.json({
      name: req.user.name, parties: req.user.parties, open_orders: openOrders, value_left: round2(valueLeft),
      lines_left: coming.length, overdue_lines: coming.filter((c) => c.overdue).length,
      coming_next: coming.slice(0, 8), recent_orders: recent.orders.slice(0, 4),
      photos: await photoViews(photos),
      posts: await news.currentPosts(3), contact: await news.getContact(),
      new_catalogues: await db.Catalogue.countDocuments({ createdAt: { $gte: new Date(Date.now() - 30 * 864e5) } }),
      ...(await synced()),
    });
  });

  r.get("/my/orders", ...distributor, async (req, res) => {
    res.json({ ...(await listOrders("sales", req.query, mine(req))), ...(await synced()) });
  });

  r.post("/my/photos", ...distributor, express.raw({ type: IMAGE_TYPES, limit: "10mb" }), async (req, res) => {
    const party = String(req.query.party || req.user.parties[0] || "");
    if (!req.user.parties.length) return res.status(400).json({ detail: "Your login isn't linked to your account yet. Please call SNJ." });
    if (!req.user.parties.includes(party)) return res.status(400).json({ detail: "Pick one of your own accounts." });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ detail: "Choose a photo (JPEG or PNG)." });
    const type = req.get("content-type");
    const fileId = await db.saveFile(req.body, `order-${Date.now()}.${type.split("/")[1]}`, type);
    const note = String(req.query.note || "").trim().slice(0, 500);
    const p = await db.OrderPhoto.create({
      party, username: req.user.username, note, file_id: fileId, content_type: type, size: req.body.length,
      history: [{ at: new Date(), by: req.user.username, status: "received", note: "" }],
    });
    res.json((await photoViews([p.toObject()]))[0]);
  });

  // Order again: the same items and sizes as a past order (quantities can change), checked by staff like a photo.
  r.post("/my/repeat", ...distributor, express.json(), async (req, res) => {
    const { guid, note = "" } = req.body || {};
    const order = await db.Order.findOne({ guid: String(guid || ""), kind: "sales" }).lean();
    if (!order || !req.user.parties.includes(order.party)) return res.status(404).json({ detail: "Order not found." });
    const known = new Map(order.lines.map((l) => [`${l.item}|${l.size}`, l]));
    const lines = [];
    for (const l of Array.isArray(req.body.lines) ? req.body.lines : []) {
      const was = known.get(`${l.item}|${l.size || ""}`);
      const qty = Number(l.qty);
      if (!was || !(qty > 0)) continue;  // only items from that order, and only those wanted
      // SNJ's 50% + 20% chain shows in Tally as an amount of 0.4 x rate x qty.
      const share = was.rate && was.qty ? Math.abs(was.amount) / (was.rate * was.qty) : 1;
      lines.push({ item: was.item, size: was.size, qty, unit: was.unit, rate: was.rate,
                   discount: Math.abs(share - 0.4) < 0.02 ? "50+20" : "none" });
    }
    if (!lines.length) return res.status(400).json({ detail: "Enter a quantity for at least one item." });
    const p = await db.OrderPhoto.create({
      kind: "repeat", from_order: { guid: order.guid, number: order.number }, lines, party: order.party,
      username: req.user.username, note: String(note).trim().slice(0, 500),
      history: [{ at: new Date(), by: req.user.username, status: "received", note: "" }],
    });
    res.json((await photoViews([p.toObject()]))[0]);
  });

  r.get("/my/photos", ...distributor, async (req, res) => {
    const photos = await db.OrderPhoto.find(mine(req)).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ photos: await photoViews(photos), parties: req.user.parties });
  });

  // --- both ---

  r.get("/photos/:id/image", requireLogin, async (req, res) => {
    const p = await db.OrderPhoto.findById(req.params.id).lean().catch(() => null);
    if (!p || !p.file_id || !canSee(req, p.party)) return res.status(404).json({ detail: "Photo not found." });
    db.sendFile(res, p.file_id, p.content_type, `order-photo.${p.content_type.split("/")[1]}`);
  });

  r.get("/catalogue", requireLogin, async (req, res) => {
    const list = await db.Catalogue.find().sort({ createdAt: -1 }).lean();
    res.json({ catalogues: list.map((c) => ({ id: String(c._id), title: c.title, size: c.size, created_at: c.createdAt })),
               can_upload: req.user.role === "staff" });
  });

  r.get("/catalogue/:id/file", requireLogin, async (req, res) => {
    const c = await db.Catalogue.findById(req.params.id).lean().catch(() => null);
    if (!c) return res.status(404).json({ detail: "This catalogue has been removed." });
    db.sendFile(res, c.file_id, "application/pdf", `${c.title}.pdf`);
  });

  // --- staff ---

  r.get("/photo-orders", ...staff, async (req, res) => {
    const photos = await db.OrderPhoto.find().sort({ createdAt: -1 }).limit(200).lean();
    const views = await photoViews(photos);
    const open = views.filter((p) => p.stage === "received");
    res.json({ photos: req.query.show === "all" ? views : open, open: open.length, total: views.length });
  });

  r.get("/photo-orders/:id", ...staff, async (req, res) => {
    const p = await db.OrderPhoto.findById(req.params.id).lean().catch(() => null);
    if (!p) return res.status(404).json({ detail: "Photo not found." });
    res.json((await photoViews([p]))[0]);
  });

  r.post("/photo-orders/:id/reject", ...staff, express.json(), async (req, res) => {
    const note = String((req.body || {}).note || "").trim().slice(0, 500);
    if (!note) return res.status(400).json({ detail: "Say why, so the distributor knows what to do." });
    const p = await db.OrderPhoto.findOneAndUpdate(
      { _id: req.params.id, status: "received" },
      { status: "rejected", staff_note: note,
        $push: { history: { at: new Date(), by: req.user.username, status: "rejected", note } } },
      { returnDocument: "after" },
    ).lean().catch(() => null);
    if (!p) return res.status(409).json({ detail: "This photo has already been dealt with." });
    res.json((await photoViews([p]))[0]);
  });

  r.post("/catalogue", ...staff, express.raw({ type: "application/pdf", limit: "25mb" }), async (req, res) => {
    const title = String(req.query.title || "").trim().slice(0, 120);
    if (!title) return res.status(400).json({ detail: "Give the catalogue a name." });
    if (!Buffer.isBuffer(req.body) || req.body.subarray(0, 5).toString() !== "%PDF-") {
      return res.status(400).json({ detail: "Choose a PDF file." });
    }
    const fileId = await db.saveFile(req.body, `${title}.pdf`, "application/pdf");
    const c = await db.Catalogue.create({ title, file_id: fileId, size: req.body.length, uploaded_by: req.user.username });
    res.json({ id: String(c._id), title, size: c.size, created_at: c.createdAt });
  });

  r.delete("/catalogue/:id", ...staff, async (req, res) => {
    const c = await db.Catalogue.findByIdAndDelete(req.params.id).lean().catch(() => null);
    if (!c) return res.status(404).json({ detail: "Already removed." });
    await db.deleteFile(c.file_id);
    res.json({ ok: true });
  });

  r.get("/distributors", ...staff, async (req, res) => {
    const users = await db.User.find({ role: "distributor" }).sort({ name: 1 }).lean();
    res.json({ distributors: users.map(distributorView), parties: await partyChoices() });
  });

  r.post("/distributors", ...staff, express.json(), async (req, res) => {
    const body = req.body || {};
    const phone = String(body.phone || "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
    const name = String(body.name || "").trim();
    const parties = [...new Set((Array.isArray(body.parties) ? body.parties : []).map((p) => String(p).trim()).filter(Boolean))];
    const password = String(body.password || "");
    const problems = [];
    if (!/^[6-9]\d{9}$/.test(phone)) problems.push("Enter a 10-digit mobile number.");
    if (!name) problems.push("Enter the distributor's name.");
    if (!parties.length) problems.push("Link at least one Tally customer.");
    const known = new Set(await partyChoices());
    const unknown = parties.filter((p) => !known.has(p));
    if (unknown.length) problems.push(`Not a Tally customer: ${unknown.join(", ")}.`);
    const existing = phone && await db.User.findOne({ username: phone }).lean();
    if (existing && (existing.role || "staff") !== "distributor") problems.push("That number is a staff login.");
    if (password && password.length < 8) problems.push("The password needs at least 8 characters.");
    if (!existing && !password) problems.push("Set a password for the new login.");
    if (problems.length) return res.status(400).json({ detail: problems.join(" "), problems });
    await db.setDistributor({ phone, name, parties, password, active: body.active !== false });
    res.json(distributorView(await db.User.findOne({ username: phone }).lean()));
  });

  return r;
}

module.exports = { routes, photoViews };
