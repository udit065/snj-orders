// MongoDB models and the queries that keep the website's copy of Tally up to date.
const crypto = require("crypto");
const mongoose = require("mongoose");

const { Schema } = mongoose;

const lineSchema = new Schema({
  idx: Number, item: String, size: String, qty: Number, unit: String, rate: Number,
  amount: Number, due_date: String, godown: String, order_no: String,
}, { _id: false });

const Order = mongoose.model("Order", new Schema({
  guid: { type: String, unique: true }, kind: String, number: String, date: { type: String, index: true },
  party: String, voucher_type: String, reference: String, narration: String, total: Number,
  optional: Boolean, master_id: String, alter_id: String, cancelled: Boolean, lines: [lineSchema],
}));

const fulfilmentSchema = new Schema({
  kind: String, party: String, order_no: String, item: String, size: String, qty: Number,
  date: { type: String, index: true }, voucher: String,
});
fulfilmentSchema.index({ kind: 1, party: 1, order_no: 1, item: 1, size: 1 });
const Fulfilment = mongoose.model("Fulfilment", fulfilmentSchema);

const Meta = mongoose.model("Meta", new Schema({ _id: String, value: String }));

const User = mongoose.model("User", new Schema({
  username: { type: String, unique: true }, name: String, pw_hash: String, active: { type: Boolean, default: true },
}));

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
async function replaceAll(orders, fulfilments, syncedAt, from, to) {
  const period = from ? { date: { $gte: from, $lte: to } } : {};
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

// --- staff logins: same format as the Python version (pbkdf2-sha256, salt$digest) ---

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
    { name, pw_hash: hashPassword(password), active: true }, { upsert: true });
}

async function authenticate(username, password) {
  const user = await User.findOne({ username: username.toLowerCase().trim(), active: true }).lean();
  return user && checkPassword(password, user.pw_hash) ? user : null;
}

module.exports = {
  Order, Fulfilment, User, setMeta, getMeta, replaceAll, finishFull, hasFull, setUser, authenticate,
};
