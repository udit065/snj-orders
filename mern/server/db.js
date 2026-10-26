// MongoDB models and the queries that keep the website's copy of Tally up to date.
const crypto = require("crypto");
const mongoose = require("mongoose");

const { Schema } = mongoose;

const lineSchema = new Schema({
  idx: Number, item: String, size: String, qty: Number, unit: String, rate: Number,
  amount: Number, due_date: String, godown: String, order_no: String,
}, { _id: false });

// status / next_due / items_count are worked out from the deliveries after each sync
// (orders.js refreshProgress), so lists can filter and page inside MongoDB.
const orderSchema = new Schema({
  guid: { type: String, unique: true }, kind: String, number: String, date: { type: String, index: true },
  party: String, voucher_type: String, reference: String, narration: String, total: Number,
  optional: Boolean, master_id: String, alter_id: String, cancelled: Boolean, lines: [lineSchema],
  status: String, next_due: String, items_count: Number,
});
orderSchema.index({ kind: 1, status: 1, date: -1, number: -1 });
orderSchema.index({ kind: 1, party: 1 });
const Order = mongoose.model("Order", orderSchema);

const fulfilmentSchema = new Schema({
  kind: String, party: String, order_no: String, item: String, size: String, qty: Number,
  date: { type: String, index: true }, voucher: String,
});
fulfilmentSchema.index({ kind: 1, party: 1, order_no: 1, item: 1, size: 1 });
const Fulfilment = mongoose.model("Fulfilment", fulfilmentSchema);

const Meta = mongoose.model("Meta", new Schema({ _id: String, value: String }));

// Staff see everything. A distributor signs in with their mobile number and sees only
// the Tally customers (parties) linked to their login.
const User = mongoose.model("User", new Schema({
  username: { type: String, unique: true }, name: String, pw_hash: String, active: { type: Boolean, default: true },
  role: { type: String, default: "staff" }, parties: [String], phone: String,
}, { timestamps: true }));

// What the order form offers, as last sent by the bridge from Tally.
const Masters = mongoose.model("Masters", new Schema({
  _id: String, customers: [{ _id: false, name: String, gstin: String, state: String }],
  items: [{ _id: false, name: String, unit: String }], updated_at: Date,
}));

// A new order entered on the website, on its way into Tally, with its history.
// waiting -> sending -> done | failed; or withdrawn before sending (see changes.js).
const Change = mongoose.model("Change", new Schema({
  kind: { type: String, default: "create_order" },
  status: { type: String, index: true },
  order: {
    order_no: String, date: String, party: String, reference: String, narration: String,
    lines: [{ _id: false, item: String, unit: String, rate: Number, discount: String,
              sizes: [{ _id: false, size: String, qty: Number, due_date: String }] }],
  },
  total: Number,
  created_by: String,
  error: String,
  history: [{ _id: false, at: Date, by: String, status: String, note: String }],
}, { timestamps: true }));

// A distributor's order request until staff enter it as an order (a Change): a photo of their
// order pad, or "order again" of a past order (kind "repeat", with its lines and no photo).
const OrderPhoto = mongoose.model("OrderPhoto", new Schema({
  kind: { type: String, default: "photo" }, from_order: { guid: String, number: String },
  lines: [{ _id: false, item: String, size: String, qty: Number, unit: String, rate: Number, discount: String }],
  party: String, username: String, note: String, file_id: Schema.Types.ObjectId, content_type: String, size: Number,
  status: { type: String, default: "received", index: true },  // received -> entered | rejected
  change_id: Schema.Types.ObjectId, staff_note: String,
  history: [{ _id: false, at: Date, by: String, status: String, note: String }],
}, { timestamps: true }));

// What a distributor tells SNJ: a payment they made, or a damage / short-supply claim.
// Staff check it and accept or send it back; the bridge doesn't write these into Tally.
const Notice = mongoose.model("Notice", new Schema({
  kind: { type: String, index: true },  // payment | claim
  party: String, username: String, note: String,
  amount: Number, paid_on: String, mode: String, reference: String,                      // payment
  order: { guid: String, number: String }, item: String, qty: Number, problem: String,   // claim
  files: [{ _id: false, file_id: Schema.Types.ObjectId, content_type: String, size: Number }],
  status: { type: String, default: "open", index: true },  // open -> accepted | rejected
  staff_note: String,
  history: [{ _id: false, at: Date, by: String, status: String, note: String }],
}, { timestamps: true }));

// Catalogue PDFs staff upload for distributors.
const Catalogue = mongoose.model("Catalogue", new Schema({
  title: String, file_id: Schema.Types.ObjectId, size: Number, uploaded_by: String,
}, { timestamps: true }));

// Photos and PDFs live in MongoDB's file store (GridFS), as they can be bigger than a document.
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "files" });

function saveFile(buffer, filename, contentType) {
  return new Promise((resolve, reject) => {
    const up = bucket().openUploadStream(filename, { metadata: { contentType } });
    up.on("error", reject).on("finish", () => resolve(up.id));
    up.end(buffer);
  });
}

function sendFile(res, id, contentType, filename) {
  res.set({ "Content-Type": contentType, "Cache-Control": "private, max-age=86400",
            "Content-Disposition": `inline; filename="${String(filename).replace(/[^\w. -]/g, "_")}"` });
  bucket().openDownloadStream(id)
    .on("error", () => (res.headersSent ? res.end() : res.status(404).json({ detail: "File not found." })))
    .pipe(res);
}

const deleteFile = (id) => bucket().delete(id).catch(() => {});

function toOrder(o) {
  return {
    guid: o.guid, kind: o.kind, number: o.number, date: o.date, party: o.party, voucher_type: o.voucher_type,
    reference: o.reference || "", narration: o.narration || "", total: o.total || 0, optional: !!o.optional,
    master_id: o.master_id || "", alter_id: o.alter_id || "", cancelled: !!o.cancelled,
    lines: (o.lines || []).map((l, idx) => ({
      idx, item: l.item, size: l.size || "", qty: l.qty, unit: l.unit, rate: l.rate, amount: l.amount,
      due_date: l.due_date || "", godown: l.godown || "", order_no: l.order_no || o.number,
    })),
  };
}

function toFulfilment(f) {
  return { kind: f.kind, party: f.party, order_no: f.order_no, item: f.item, size: f.size || "",
           qty: f.qty, date: f.date, voucher: f.voucher };
}

async function setMeta(key, value) {
  await Meta.updateOne({ _id: key }, { value }, { upsert: true });
}

async function getMeta(key) {
  const m = await Meta.findById(key).lean();
  return m ? m.value : null;
}

// Swap in a fresh copy from Tally. With dates, only that period is replaced (a quick
// sync, or one month of a full copy); everything is replaced otherwise.
// Returns the parties whose orders or deliveries changed, so their order status can be worked out again.
async function replaceAll(orders, fulfilments, syncedAt, from, to) {
  const period = from ? { date: { $gte: from, $lte: to } } : {};
  const touched = new Set([...orders, ...fulfilments].map((x) => x.party));
  if (from) {
    for (const p of await Order.distinct("party", period)) touched.add(p);
    for (const p of await Fulfilment.distinct("party", period)) touched.add(p);
  }
  await Order.deleteMany(period);
  await Fulfilment.deleteMany(period);
  if (orders.length) {
    // An order whose date was moved into this period replaces its old copy.
    await Order.bulkWrite(orders.map((o) => ({
      replaceOne: { filter: { guid: o.guid }, replacement: toOrder(o), upsert: true },
    })));
  }
  if (fulfilments.length) await Fulfilment.insertMany(fulfilments.map(toFulfilment), { ordered: false });
  await setMeta("synced_at", syncedAt);
  if (!from) await setMeta("full_synced_at", syncedAt);
  return from ? [...touched] : null;  // null: everything was replaced
}

// A full copy has arrived month by month; drop whatever lies outside its period.
async function finishFull(from, to, syncedAt) {
  const outside = { $or: [{ date: { $lt: from } }, { date: { $gt: to } }] };
  await Order.deleteMany(outside);
  await Fulfilment.deleteMany(outside);
  await setMeta("synced_at", syncedAt);
  await setMeta("full_synced_at", syncedAt);
}

async function hasFull() {
  return (await getMeta("full_synced_at")) !== null;
}

// --- logins: same format as the Python version (pbkdf2-sha256, salt$digest) ---

function hashPassword(password, salt = crypto.randomBytes(16)) {
  const digest = crypto.pbkdf2Sync(password, salt, 200000, 32, "sha256");
  return salt.toString("hex") + "$" + digest.toString("hex");
}

function checkPassword(password, stored) {
  const [saltHex] = stored.split("$");
  const a = Buffer.from(hashPassword(password, Buffer.from(saltHex, "hex")));
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function setUser(username, name, password) {
  await User.updateOne({ username: username.toLowerCase() },
    { name, pw_hash: hashPassword(password), active: true, role: "staff" }, { upsert: true });
}

// A distributor's login: their mobile number, the Tally customers they see, and a password
// (kept as it was when none is given).
async function setDistributor({ phone, name, parties, password, active = true }) {
  const update = { name, parties, phone, active, role: "distributor" };
  if (password) update.pw_hash = hashPassword(password);
  await User.updateOne({ username: phone }, update, { upsert: true });
}

async function authenticate(username, password) {
  const user = await User.findOne({ username: username.toLowerCase().trim(), active: true }).lean();
  return user && checkPassword(password, user.pw_hash) ? user : null;
}

module.exports = {
  Order, Fulfilment, User, Masters, Change, OrderPhoto, Notice, Catalogue, setMeta, getMeta, replaceAll, finishFull, hasFull,
  setUser, setDistributor, authenticate, saveFile, sendFile, deleteFile,
};
