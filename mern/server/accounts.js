// Customers' accounts from Tally, read only: balance and ageing, bills, statement, payments.
// The bridge sends vouchers a period at a time, and balances with Tally's open bills every half hour.
const express = require("express");
const db = require("./db");
const { today } = require("./orders");

const round2 = (n) => Math.round((n || 0) * 100) / 100;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(s));
const addDays = (date, days) => new Date(Date.parse(date) + days * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const KIND = { Sales: "Bill", Receipt: "Payment", "Credit Note": "Credit note", "Debit Note": "Debit note",
               Journal: "Adjustment", Payment: "Refund" };

// 1 April of the financial year `date` falls in.
function fyStart(date = today()) {
  const [y, m] = date.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

function toEntry(e) {
  return {
    key: String(e.id || `${e.guid}|${e.party}`), guid: e.guid, date: e.date, number: e.number || "",
    voucher_type: e.voucher_type || "", base: e.base, party: e.party, amount: round2(e.amount),
    reference: e.reference || "", narration: e.narration || "",
    bills: (e.bills || []).map((b) => ({ ref: b.ref || "", type: b.type || "", amount: round2(b.amount),
                                         credit_days: Number.isInteger(b.credit_days) ? b.credit_days : undefined })),
    ship: e.ship || undefined, lines: e.lines || [],
  };
}

// Open bills for these parties. From Tally's Bills Receivable report when it came; otherwise
// worked out from the vouchers' bill allocations, with the opening balance as one bill.
async function openBills(parties) {
  const accounts = await db.PartyAccount.find({ name: { $in: parties } }).lean();
  const acct = new Map(accounts.map((a) => [a.name, a]));
  const out = new Map(parties.map((p) => [p, []]));
  if ((await db.getMeta("bills_source")) === "tally") {
    for (const b of await db.OpenBill.find({ party: { $in: parties } }).lean()) {
      out.get(b.party).push({ ref: b.ref, date: b.date, due_date: b.due_date || b.date, amount: b.amount });
    }
    return out;
  }
  const from = fyStart();
  const entries = await db.AcctEntry.find({ party: { $in: parties }, date: { $gte: from } }, { lines: 0 }).lean();
  for (const party of parties) {
    const refs = new Map();
    let againstOpening = 0;
    let onAccount = 0;
    for (const e of entries.filter((x) => x.party === party)) {
      for (const b of e.bills || []) {
        if (b.type === "On Account" || !b.ref) { onAccount += b.amount; continue; }
        if (!refs.has(b.ref)) refs.set(b.ref, { ref: b.ref, date: "", credit_days: null, amount: 0 });
        const r = refs.get(b.ref);
        r.amount += b.amount;
        if (b.type === "New Ref" && (!r.date || e.date < r.date)) { r.date = e.date; r.credit_days = b.credit_days ?? null; }
      }
    }
    const a = acct.get(party) || {};
    const bills = [];
    for (const r of refs.values()) {
      if (!r.date) { againstOpening += r.amount; continue; }  // a bill from before these vouchers
      if (Math.abs(r.amount) < 0.5) continue;
      bills.push({ ref: r.ref, date: r.date, due_date: addDays(r.date, r.credit_days ?? a.credit_days ?? 0), amount: round2(r.amount) });
    }
    const opening = round2((a.opening || 0) + againstOpening);
    if (Math.abs(opening) >= 0.5) bills.push({ ref: "Opening balance", date: from, due_date: from, amount: opening });
    if (Math.abs(onAccount) >= 0.5) bills.push({ ref: "On account", date: from, due_date: from, amount: round2(onAccount) });
    out.set(party, bills);
  }
  return out;
}

// Balance, ageing of what is overdue, credit limit, and the open bills.
async function summaryOf(party, bills) {
  const a = await db.PartyAccount.findOne({ name: party }).lean();
  const now = today();
  const ageing = { not_due: 0, d1_15: 0, d16_30: 0, d30_plus: 0 };
  let credits = 0;
  const open = bills.map((b) => {
    const late = b.amount > 0 ? Math.max(0, daysBetween(b.due_date, now)) : 0;
    if (b.amount <= 0) credits += b.amount;
    else if (!late) ageing.not_due += b.amount;
    else if (late <= 15) ageing.d1_15 += b.amount;
    else if (late <= 30) ageing.d16_30 += b.amount;
    else ageing.d30_plus += b.amount;
    return { ...b, days_late: late };
  }).sort((x, y) => (x.due_date || "").localeCompare(y.due_date || ""));
  for (const k in ageing) ageing[k] = round2(ageing[k]);
  const overdue = round2(ageing.d1_15 + ageing.d16_30 + ageing.d30_plus);
  const balance = a ? round2(a.closing) : round2(open.reduce((t, b) => t + b.amount, 0));
  const lastPay = await db.AcctEntry.findOne({ party, base: "Receipt" }, { lines: 0 }).sort({ date: -1 }).lean();
  return {
    party, known: !!a, balance, opening: a ? round2(a.opening) : null, overdue, ageing, unadjusted_credit: round2(-credits),
    credit_limit: a?.credit_limit || null, credit_days: a?.credit_days ?? null,
    available: a?.credit_limit ? round2(a.credit_limit - balance) : null,
    over_limit: !!(a?.credit_limit && balance > a.credit_limit),
    oldest_overdue_days: Math.max(0, ...open.filter((b) => b.amount > 0).map((b) => b.days_late)),
    last_payment: lastPay ? { date: lastPay.date, amount: round2(-lastPay.amount), number: lastPay.number } : null,
    bills: open, as_of: await db.getMeta("accounts_at"), today: now,
  };
}

const entryView = (e) => ({
  id: String(e._id), date: e.date, number: e.number, voucher_type: e.voucher_type, kind: KIND[e.base] || e.base,
  base: e.base, party: e.party, amount: e.amount, reference: e.reference, narration: e.narration,
  bills: e.bills, ship: e.ship && Object.values(e.ship).some(Boolean) ? e.ship : null,
});

// A payment a distributor told us about is confirmed when a matching receipt reaches Tally:
// same customer, the same amount (to the rupee), dated from 3 days before to 20 days after.
async function matchPayments(parties) {
  const waiting = await db.Notice.find({ kind: "payment", status: "open", party: { $in: parties } }).sort({ createdAt: 1 });
  if (!waiting.length) return 0;
  const used = new Set((await db.Notice.distinct("matched_key", { matched_key: { $ne: null } })));
  let matched = 0;
  for (const n of waiting) {
    const receipts = await db.AcctEntry.find({
      party: n.party, base: "Receipt", date: { $gte: addDays(n.paid_on, -3), $lte: addDays(n.paid_on, 20) },
      amount: { $gte: -n.amount - 1, $lte: -n.amount + 1 },
    }, { lines: 0 }).sort({ date: 1 }).lean();
    // One that mentions their UTR / cheque number first.
    const ref = (n.reference || "").toLowerCase();
    const r = receipts.filter((x) => !used.has(x.key))
      .sort((x, y) => Number(!!ref && `${y.narration} ${y.reference}`.toLowerCase().includes(ref))
                    - Number(!!ref && `${x.narration} ${x.reference}`.toLowerCase().includes(ref)))[0];
    if (!r) continue;
    used.add(r.key);
    const note = `In Tally: ${r.voucher_type} ${r.number} of ${r.date}`;
    n.set({ status: "accepted", staff_note: note, matched_key: r.key });
    n.history.push({ at: new Date(), by: "Tally", status: "accepted", note });
    await n.save();
    matched += 1;
  }
  return matched;
}

function bridgeRoutes({ requireBridge }) {
  const r = express.Router();
  r.use(requireBridge);

  // One period of vouchers replaces what the website had for those dates.
  r.post("/accounts", express.json({ limit: "100mb" }), async (req, res) => {
    const { from, to, entries } = req.body || {};
    if (!isDate(from) || !isDate(to) || !Array.isArray(entries)) return res.status(400).json({ detail: "from, to and entries" });
    const docs = entries.filter((e) => e && e.party && isDate(e.date) && e.date >= from && e.date <= to).map(toEntry);
    await db.AcctEntry.deleteMany({ date: { $gte: from, $lte: to } });
    if (docs.length) await db.AcctEntry.insertMany(docs);
    await db.setMeta("accounts_at", new Date().toISOString());
    const matched = await matchPayments([...new Set(docs.map((d) => d.party))]);
    res.json({ entries: docs.length, payments_confirmed: matched });
  });

  r.post("/balances", express.json({ limit: "50mb" }), async (req, res) => {
    const { parties = [], bills = [], bills_source: source } = req.body || {};
    if (!parties.length) return res.status(400).json({ detail: "No balances." });
    await db.PartyAccount.deleteMany({});
    await db.PartyAccount.insertMany(parties.map((p) => ({
      name: p.name, opening: round2(p.opening), closing: round2(p.closing),
      credit_limit: p.credit_limit || null, credit_days: Number.isInteger(p.credit_days) ? p.credit_days : null,
    })));
    await db.OpenBill.deleteMany({});
    if (source === "tally" && bills.length) {
      await db.OpenBill.insertMany(bills.map((b) => ({ party: b.party, ref: b.ref || "", date: b.date,
                                                       due_date: b.due_date || b.date, amount: round2(b.amount) })));
    }
    await db.setMeta("bills_source", source === "tally" && bills.length ? "tally" : "vouchers");
    await db.setMeta("accounts_at", new Date().toISOString());
    res.json({ parties: parties.length, bills: source === "tally" ? bills.length : 0 });
  });

  return r;
}

function routes({ requireLogin, requireStaff }) {
  const r = express.Router();
  const staff = [requireLogin, requireStaff];

  // Whose account: staff may open any; a distributor only their own (the first by default).
  const party = (req, res, next) => {
    const p = String(req.query.party || (req.user.role === "distributor" ? req.user.parties[0] : "") || "");
    if (!p || (req.user.role !== "staff" && !req.user.parties.includes(p))) {
      return res.status(404).json({ detail: "Account not found." });
    }
    req.party = p;
    next();
  };
  const acct = [requireLogin, party];

  r.get("/account/summary", ...acct, async (req, res) => {
    const bills = (await openBills([req.party])).get(req.party);
    res.json({ ...(await summaryOf(req.party, bills)), parties: req.user.role === "staff" ? [req.party] : req.user.parties });
  });

  // Bills (sales invoices), newest first, with what is still to pay on each.
  r.get("/account/bills", ...acct, async (req, res) => {
    const status = String(req.query.status || "all");
    const open = new Map((await openBills([req.party])).get(req.party).map((b) => [b.ref, b]));
    const invoices = await db.AcctEntry.find({ party: req.party, base: "Sales" }, { lines: 0 }).sort({ date: -1, number: -1 }).lean();
    const now = today();
    let rows = invoices.map((e) => {
      const nb = (e.bills || []).find((b) => b.type === "New Ref");
      const o = open.get(nb ? nb.ref : e.number);
      const due = o ? o.due_date : addDays(e.date, nb?.credit_days ?? 0);
      const pending = o ? round2(o.amount) : 0;
      return { ...entryView(e), pending, due_date: due, days_late: pending > 0 ? Math.max(0, daysBetween(due, now)) : 0,
               state: pending <= 0 ? "paid" : pending < e.amount - 0.5 ? "part" : "unpaid" };
    });
    if (status === "open") rows = rows.filter((b) => b.pending > 0);
    res.json({ bills: rows.slice(0, 300), total: rows.length });
  });

  r.get("/account/entry/:id", requireLogin, async (req, res) => {
    const e = await db.AcctEntry.findById(req.params.id).lean().catch(() => null);
    if (!e || (req.user.role !== "staff" && !req.user.parties.includes(e.party))) {
      return res.status(404).json({ detail: "Not found." });
    }
    const a = await db.PartyAccount.findOne({ name: e.party }).lean();
    const masters = await db.Masters.findById("tally", { customers: 1 }).lean();
    const customer = masters?.customers.find((c) => c.name === e.party);
    res.json({ ...entryView(e), lines: e.lines, gstin: customer?.gstin || "", credit_days: a?.credit_days ?? null });
  });

  // Statement: opening balance on `from`, every voucher to `to`, running balance, closing.
  r.get("/account/statement", ...acct, async (req, res) => {
    const start = fyStart();
    let from = isDate(req.query.from) ? req.query.from : start;
    const to = isDate(req.query.to) ? req.query.to : today();
    if (from < start) from = start;
    const a = await db.PartyAccount.findOne({ name: req.party }).lean();
    const before = await db.AcctEntry.aggregate([
      { $match: { party: req.party, date: { $gte: start, $lt: from } } },
      { $group: { _id: null, t: { $sum: "$amount" } } }]);
    const opening = round2((a?.opening || 0) + (before[0]?.t || 0));
    const entries = await db.AcctEntry.find({ party: req.party, date: { $gte: from, $lte: to } }, { lines: 0 })
      .sort({ date: 1, number: 1 }).lean();
    let bal = opening;
    const rows = entries.map((e) => {
      bal = round2(bal + e.amount);
      return { ...entryView(e), debit: e.amount > 0 ? e.amount : 0, credit: e.amount < 0 ? -e.amount : 0, balance: bal };
    });
    // If every voucher is here, the closing matches Tally's own balance.
    const all = await db.AcctEntry.aggregate([{ $match: { party: req.party, date: { $gte: start } } },
                                              { $group: { _id: null, t: { $sum: "$amount" } } }]);
    const complete = a ? Math.abs(round2(a.opening + (all[0]?.t || 0)) - a.closing) < 1 : null;
    res.json({ party: req.party, from, to, fy_start: start, opening, closing: bal, rows,
               debit: round2(rows.reduce((t, x) => t + x.debit, 0)), credit: round2(rows.reduce((t, x) => t + x.credit, 0)),
               complete, tally_balance: a ? a.closing : null, as_of: await db.getMeta("accounts_at") });
  });

  // Payments SNJ has received (and credit notes), with the bills each one settled.
  r.get("/account/receipts", ...acct, async (req, res) => {
    const list = await db.AcctEntry.find({ party: req.party, base: { $in: ["Receipt", "Credit Note"] } }, { lines: 0 })
      .sort({ date: -1 }).limit(200).lean();
    res.json({ receipts: list.map((e) => ({ ...entryView(e), received: round2(-e.amount),
      settled: (e.bills || []).filter((b) => b.type === "Agst Ref").map((b) => ({ ref: b.ref, amount: round2(-b.amount) })) })) });
  });

  // Your year with SNJ: billed and paid, month by month since 1 April.
  r.get("/account/year", ...acct, async (req, res) => {
    const start = fyStart();
    const rows = await db.AcctEntry.aggregate([
      { $match: { party: req.party, date: { $gte: start } } },
      { $group: { _id: { m: { $substr: ["$date", 0, 7] }, b: "$base" }, t: { $sum: "$amount" } } }]);
    const months = [];
    for (let d = start; d <= today(); d = addDays(`${d.slice(0, 7)}-28`, 5).slice(0, 7) + "-01") months.push(d.slice(0, 7));
    const by = (m, b) => rows.find((x) => x._id.m === m && x._id.b === b)?.t || 0;
    const out = months.map((m) => ({ month: m, billed: round2(by(m, "Sales")), paid: round2(-by(m, "Receipt")),
                                     returns: round2(-by(m, "Credit Note")) }));
    const sum = (k) => round2(out.reduce((t, x) => t + x[k], 0));
    res.json({ months: out, billed: sum("billed"), paid: sum("paid"), returns: sum("returns"), fy_start: start });
  });

  // Year-end balance confirmation: the distributor agrees with the balance, or says why not.
  r.get("/account/confirmations", ...acct, async (req, res) => {
    const list = await db.BalanceConfirm.find({ party: req.party }).sort({ createdAt: -1 }).limit(10).lean();
    res.json({ confirmations: list.map((c) => ({ id: String(c._id), as_of: c.as_of, balance: c.balance, agree: c.agree,
                                                note: c.note || "", by: c.username, at: c.createdAt })) });
  });

  r.post("/account/confirm", ...acct, express.json(), async (req, res) => {
    if (req.user.role !== "distributor") return res.status(403).json({ detail: "Only the distributor can confirm their balance." });
    const { agree, note = "" } = req.body || {};
    if (typeof agree !== "boolean") return res.status(400).json({ detail: "Say whether the balance is right." });
    if (!agree && !String(note).trim()) return res.status(400).json({ detail: "Say what differs, so SNJ can check." });
    const a = await db.PartyAccount.findOne({ name: req.party }).lean();
    if (!a) return res.status(400).json({ detail: "Your balance hasn't arrived from Tally yet." });
    const c = await db.BalanceConfirm.create({ party: req.party, username: req.user.username, as_of: today(),
                                               balance: a.closing, agree, note: String(note).trim().slice(0, 500) });
    res.json({ id: String(c._id), agree: c.agree, balance: c.balance, as_of: c.as_of });
  });

  // Staff: every customer with a balance, most overdue first.
  r.get("/accounts", ...staff, async (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    let list = await db.PartyAccount.find().lean();
    if (q) list = list.filter((a) => a.name.toLowerCase().includes(q));
    const show = String(req.query.show || "owing");
    if (show === "owing") list = list.filter((a) => a.closing > 0.5);
    const bills = await openBills(list.map((a) => a.name));
    const now = today();
    const confirms = new Map((await db.BalanceConfirm.find({ party: { $in: list.map((a) => a.name) } }).sort({ createdAt: 1 }).lean())
      .map((c) => [c.party, c]));
    const rows = list.map((a) => {
      const own = bills.get(a.name) || [];
      const overdue = round2(own.filter((b) => b.amount > 0 && b.due_date < now).reduce((t, b) => t + b.amount, 0));
      const oldest = Math.max(0, ...own.filter((b) => b.amount > 0).map((b) => daysBetween(b.due_date, now)));
      const c = confirms.get(a.name);
      return { party: a.name, balance: round2(a.closing), overdue, oldest_overdue_days: oldest, credit_limit: a.credit_limit,
               over_limit: !!(a.credit_limit && a.closing > a.credit_limit),
               confirmed: c ? { agree: c.agree, as_of: c.as_of, note: c.note || "" } : null };
    }).sort((x, y) => y.overdue - x.overdue || y.balance - x.balance);
    res.json({ accounts: rows.slice(0, 500), total: rows.length,
               total_balance: round2(rows.reduce((t, x) => t + Math.max(0, x.balance), 0)),
               total_overdue: round2(rows.reduce((t, x) => t + x.overdue, 0)), as_of: await db.getMeta("accounts_at") });
  });

  return r;
}

// For the distributor Home: balance, overdue and recent bills, if accounts have arrived.
async function homeAccount(parties) {
  if (!(await db.PartyAccount.exists({ name: { $in: parties } }))) return null;
  const bills = await openBills(parties);
  let balance = 0;
  let overdue = 0;
  for (const p of parties) {
    const s = await summaryOf(p, bills.get(p));
    balance += s.balance;
    overdue += s.overdue;
  }
  const recent = await db.AcctEntry.find({ party: { $in: parties }, base: "Sales" }, { lines: 0 }).sort({ date: -1 }).limit(3).lean();
  return { balance: round2(balance), overdue: round2(overdue), recent_bills: recent.map(entryView), as_of: await db.getMeta("accounts_at") };
}

module.exports = { routes, bridgeRoutes, homeAccount, matchPayments, openBills, fyStart };
