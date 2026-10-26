// Payments and damage claims: a distributor tells SNJ, staff check and accept or send back.
// Photos come inside the JSON (already shrunk by the phone), so one request carries everything.
const express = require("express");
const db = require("./db");
const { today } = require("./orders");

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PAY_MODES = ["UPI", "NEFT / RTGS", "Cheque", "Cash", "Other"];
const PROBLEMS = ["Damaged", "Short", "Wrong item", "Other"];
const STAGE = {
  payment: { open: "SNJ is checking", accepted: "Received by SNJ", rejected: "Not found" },
  claim: { open: "SNJ is checking", accepted: "Accepted", rejected: "Not accepted" },
};
const MAX_FILES = { payment: 1, claim: 3 };

const round2 = (n) => Math.round(n * 100) / 100;
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

function view(n) {
  return {
    id: String(n._id), kind: n.kind, party: n.party, username: n.username, note: n.note || "",
    created_at: n.createdAt, status: n.status, stage_label: STAGE[n.kind][n.status],
    staff_note: n.staff_note || "", photos: (n.files || []).length, history: n.history,
    ...(n.kind === "payment"
      ? { amount: n.amount, paid_on: n.paid_on, mode: n.mode, reference: n.reference || "" }
      : { order: n.order && n.order.guid ? n.order : null, item: n.item || "", qty: n.qty || 0, problem: n.problem }),
  };
}

// "data:image/jpeg;base64,..." -> { type, buffer }, or null if it isn't a photo we take.
function decodePhoto(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m || !IMAGE_TYPES.includes(m[1])) return null;
  const buffer = Buffer.from(m[2], "base64");
  return buffer.length ? { type: m[1], buffer } : null;
}

// Checks what a distributor sent; returns the fields to save, or a list of problems.
async function readNotice(kind, body, user) {
  const problems = [];
  const party = String(body.party || user.parties[0] || "");
  if (!user.parties.length) problems.push("Your login isn't linked to your account yet. Please call SNJ.");
  else if (!user.parties.includes(party)) problems.push("Pick one of your own accounts.");
  const note = String(body.note || "").trim().slice(0, 500);
  const photos = (Array.isArray(body.photos) ? body.photos : []).slice(0, MAX_FILES[kind]).map(decodePhoto);
  if (photos.some((p) => !p)) problems.push("Photos must be JPEG, PNG or WebP.");
  const fields = { kind, party, note };

  if (kind === "payment") {
    const amount = round2(Number(body.amount));
    if (!(amount > 0) || amount > 1e9) problems.push("Enter the amount you paid.");
    const paidOn = String(body.paid_on || "");
    if (!isDate(paidOn)) problems.push("Enter the date you paid.");
    else if (paidOn > today()) problems.push("The payment date can't be in the future.");
    const mode = PAY_MODES.includes(body.mode) ? body.mode : "";
    if (!mode) problems.push("Choose how you paid.");
    const reference = String(body.reference || "").trim().slice(0, 60);
    if (mode && mode !== "Cash" && !reference) {
      problems.push(mode === "Cheque" ? "Enter the cheque number." : "Enter the UTR / transaction number.");
    }
    Object.assign(fields, { amount, paid_on: paidOn, mode, reference });
  } else {
    const problem = PROBLEMS.includes(body.problem) ? body.problem : "";
    if (!problem) problems.push("Choose what went wrong.");
    let order = null;
    if (body.order_guid) {
      order = await db.Order.findOne({ guid: String(body.order_guid), kind: "sales" }, { guid: 1, number: 1, party: 1 }).lean();
      if (!order || !user.parties.includes(order.party)) problems.push("Pick one of your own orders.");
      else if (order.party !== party) problems.push(`That order is for ${order.party}.`);
    }
    const item = String(body.item || "").trim().slice(0, 120);
    const qty = Number(body.qty) || 0;
    if (qty < 0) problems.push("The quantity can't be negative.");
    if (!item && !note) problems.push("Say which item, or describe the problem.");
    if (!photos.length) problems.push("Add at least one photo of the problem.");
    Object.assign(fields, { problem, item, qty, order: order ? { guid: order.guid, number: order.number } : undefined });
  }
  return { fields, photos, problems };
}

function routes({ requireLogin, requireStaff }) {
  const r = express.Router();
  const distributor = [requireLogin, (req, res, next) => (req.user.role === "distributor" ? next()
    : res.status(403).json({ detail: "This page is for distributors." }))];
  const staff = [requireLogin, requireStaff];
  const KIND = { payments: "payment", claims: "claim" };
  const mine = ["/my/payments", "/my/claims"];
  const theirs = ["/payments", "/claims"];
  // The kind comes from the address: /my/payments, /claims/:id ...
  const kindOf = (req, res, next) => {
    req.kinds = req.path.split("/").find((p) => KIND[p]);
    req.kind = KIND[req.kinds];
    next();
  };

  r.get(mine, ...distributor, kindOf, async (req, res) => {
    const list = await db.Notice.find({ kind: req.kind, party: { $in: req.user.parties } }).sort({ createdAt: -1 }).limit(100).lean();
    const extra = req.kind === "payment" ? { modes: PAY_MODES }
      : { problems: PROBLEMS, orders: await db.Order.find({ kind: "sales", party: { $in: req.user.parties }, cancelled: { $ne: true } },
        { guid: 1, number: 1, date: 1, party: 1, "lines.item": 1 }).sort({ date: -1 }).limit(60).lean()
        .then((os) => os.map((o) => ({ guid: o.guid, number: o.number, date: o.date, party: o.party,
                                       items: [...new Set(o.lines.map((l) => l.item))] }))) };
    res.json({ [req.kinds]: list.map(view), parties: req.user.parties, today: today(), ...extra });
  });

  r.post(mine, ...distributor, kindOf, express.json({ limit: "12mb" }), async (req, res) => {
    const { fields, photos, problems } = await readNotice(req.kind, req.body || {}, req.user);
    if (problems.length) return res.status(400).json({ detail: problems.join(" "), problems });
    const files = [];
    for (const [i, p] of photos.entries()) {
      const fileId = await db.saveFile(p.buffer, `${req.kind}-${Date.now()}-${i}.${p.type.split("/")[1]}`, p.type);
      files.push({ file_id: fileId, content_type: p.type, size: p.buffer.length });
    }
    const n = await db.Notice.create({ ...fields, files, username: req.user.username,
      history: [{ at: new Date(), by: req.user.username, status: "open", note: "" }] });
    res.json(view(n.toObject()));
  });

  r.get("/notices/:id/photo/:n", requireLogin, async (req, res) => {
    const n = await db.Notice.findById(req.params.id).lean().catch(() => null);
    const f = n && (n.files || [])[Number(req.params.n) || 0];
    if (!f || (req.user.role !== "staff" && !req.user.parties.includes(n.party))) {
      return res.status(404).json({ detail: "Photo not found." });
    }
    db.sendFile(res, f.file_id, f.content_type, `${n.kind}-photo.${f.content_type.split("/")[1]}`);
  });

  // Staff: open ones first; ?show=all for everything recent.
  r.get(theirs, ...staff, kindOf, async (req, res) => {
    const filter = { kind: req.kind, ...(req.query.show === "all" ? {} : { status: "open" }) };
    const list = await db.Notice.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    const open = await db.Notice.countDocuments({ kind: req.kind, status: "open" });
    const other = await db.Notice.countDocuments({ kind: req.kind === "payment" ? "claim" : "payment", status: "open" });
    res.json({ [req.kinds]: list.map(view), open, other_open: other });
  });

  r.post(theirs.map((p) => `${p}/:id`), ...staff, kindOf, express.json(), async (req, res) => {
    const { decision } = req.body || {};
    const note = String((req.body || {}).note || "").trim().slice(0, 500);
    if (!["accepted", "rejected"].includes(decision)) return res.status(400).json({ detail: "Accept it or send it back." });
    if (decision === "rejected" && !note) return res.status(400).json({ detail: "Say why, so the distributor knows what to do." });
    const n = await db.Notice.findOneAndUpdate(
      { _id: req.params.id, kind: req.kind, status: "open" },
      { status: decision, staff_note: note,
        $push: { history: { at: new Date(), by: req.user.username, status: decision, note } } },
      { returnDocument: "after" },
    ).lean().catch(() => null);
    if (!n) return res.status(409).json({ detail: "This has already been dealt with." });
    res.json(view(n));
  });

  return r;
}

module.exports = { routes, PAY_MODES, PROBLEMS };
