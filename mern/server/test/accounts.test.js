// Accounts from Tally: balances, open bills, statement, payments, and auto-confirming payments.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const db = require("../db");
const { createApp } = require("../app");
const { today } = require("../orders");
const { fyStart } = require("../accounts");
const sample = require("./fixtures/sample-sync.json");

let mongo;
let app;
const BRIDGE = { Authorization: "Bearer secret-token" };
const day = (n) => new Date(Date.parse(today()) + n * 864e5).toISOString().slice(0, 10);

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = createApp({ bridgeToken: "secret-token", sessionSecret: "test" });
});
after(async () => { await mongoose.disconnect(); await mongo.stop(); });

const INVOICE = (n, date, amount, days = 30) => ({
  id: `g-${n}|Agarwal Hosiery`, guid: `g-${n}`, date, number: n, voucher_type: "GST Sales", base: "Sales",
  party: "Agarwal Hosiery", amount, bills: [{ ref: n, type: "New Ref", amount, credit_days: days }],
  ship: { doc_no: "", shipped_by: "Gati", lr_no: "LR 55", lr_date: date, vehicle: "", destination: "Kolkata" },
  lines: [{ item: "NIKER S-XL-(Doz)", size: "36", qty: 2, unit: "Doz", rate: 2400, amount }],
});
const RECEIPT = (n, date, amount, against, narration = "") => ({
  id: `g-${n}|Agarwal Hosiery`, guid: `g-${n}`, date, number: n, voucher_type: "Receipt", base: "Receipt",
  party: "Agarwal Hosiery", amount: -amount, narration, bills: against ? [{ ref: against, type: "Agst Ref", amount: -amount }] : [],
  ship: null, lines: [],
});

async function signIn(username, password) {
  const agent = request.agent(app);
  await agent.post("/api/login").send({ username, password }).expect(200);
  return agent;
}

let staff;
let agarwal;
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await db.setUser("sidharth", "Sidharth", "password123");
  const raw = JSON.stringify({ synced_at: "2026-10-26T10:00:00+05:30", full: true, ...sample });
  await request(app).post("/api/sync").set(BRIDGE).set("Content-Type", "application/json").send(raw).expect(200);
  staff = await signIn("sidharth", "password123");
  await staff.post("/api/distributors").send({ phone: "9831040404", name: "Agarwal", parties: ["Agarwal Hosiery"],
    password: "dist-pass" }).expect(200);
  agarwal = await signIn("9831040404", "dist-pass");
});

async function sendAccounts({ bills = null } = {}) {
  await request(app).post("/api/bridge/accounts").set(BRIDGE).send({ from: fyStart(), to: today(), entries: [
    INVOICE("SNJ/1", day(-50), 10000), INVOICE("SNJ/2", day(-20), 5000), INVOICE("SNJ/3", day(-5), 3000),
    RECEIPT("R/1", day(-10), 4000, "SNJ/1", "NEFT UTIB777"),
  ] }).expect(200);
  await request(app).post("/api/bridge/balances").set(BRIDGE).send({
    parties: [{ name: "Agarwal Hosiery", opening: 2000, closing: 16000, credit_limit: 15000, credit_days: 30 },
              { name: "Mehta & Sons", opening: 0, closing: 0 }],
    bills: bills || [], bills_source: bills ? "tally" : "none" }).expect(200);
}

test("the bridge needs its token, and a period of vouchers replaces what was there", async () => {
  await request(app).post("/api/bridge/accounts").send({}).expect(401);
  await sendAccounts();
  assert.equal(await db.AcctEntry.countDocuments(), 4);
  await request(app).post("/api/bridge/accounts").set(BRIDGE).send({ from: day(-6), to: today(),
    entries: [INVOICE("SNJ/3", day(-5), 3500)] }).expect(200);
  const e = await db.AcctEntry.find().sort({ date: 1 }).lean();
  assert.deepEqual(e.map((x) => [x.number, x.amount]), [["SNJ/1", 10000], ["SNJ/2", 5000], ["R/1", -4000], ["SNJ/3", 3500]]);
});

test("balance and ageing worked out from the vouchers when Tally's report didn't come", async () => {
  await sendAccounts();
  const s = (await agarwal.get("/api/account/summary").expect(200)).body;
  assert.equal(s.balance, 16000);
  // Opening 2000 (due at once), SNJ/1 6000 left, 20 days late; SNJ/2 5000 not due yet; SNJ/3 3000.
  assert.deepEqual(s.ageing, { not_due: 8000, d1_15: 0, d16_30: 6000, d30_plus: 2000 });
  assert.equal(s.overdue, 8000);
  assert.deepEqual([s.credit_limit, s.available, s.over_limit], [15000, -1000, true]);
  assert.deepEqual(s.last_payment, { date: day(-10), amount: 4000, number: "R/1" });
  const bills = (await agarwal.get("/api/account/bills").expect(200)).body.bills;
  assert.deepEqual(bills.map((b) => [b.number, b.pending, b.state]), [["SNJ/3", 3000, "unpaid"], ["SNJ/2", 5000, "unpaid"], ["SNJ/1", 6000, "part"]]);
  assert.equal(bills[2].days_late, 20);
  assert.equal(bills[0].ship.lr_no, "LR 55");
  const one = (await agarwal.get(`/api/account/entry/${bills[0].id}`).expect(200)).body;
  assert.equal(one.lines[0].item, "NIKER S-XL-(Doz)");
});

test("Tally's own open bills are used when they came", async () => {
  await sendAccounts({ bills: [{ party: "Agarwal Hosiery", ref: "SNJ/1", date: day(-50), due_date: day(-40), amount: 16000 }] });
  const s = (await agarwal.get("/api/account/summary")).body;
  assert.deepEqual([s.ageing.d30_plus, s.bills.length, s.bills[0].days_late], [16000, 1, 40]);
});

test("statement runs from the opening balance, and matches Tally's balance when complete", async () => {
  await sendAccounts();
  const st = (await agarwal.get("/api/account/statement").expect(200)).body;
  assert.equal(st.opening, 2000);
  assert.deepEqual(st.rows.map((r) => r.balance), [12000, 17000, 13000, 16000]);
  assert.deepEqual([st.closing, st.debit, st.credit, st.complete], [16000, 18000, 4000, true]);
  const later = (await agarwal.get(`/api/account/statement?from=${day(-15)}`)).body;
  assert.deepEqual([later.opening, later.rows.length, later.closing], [17000, 2, 16000]);
  const rc = (await agarwal.get("/api/account/receipts")).body.receipts;
  assert.deepEqual(rc.map((r) => [r.number, r.received, r.settled]), [["R/1", 4000, [{ ref: "SNJ/1", amount: 4000 }]]]);
  const year = (await agarwal.get("/api/account/year")).body;
  assert.deepEqual([year.billed, year.paid], [18000, 4000]);
});

test("a distributor sees only their own account; staff see all", async () => {
  await sendAccounts();
  await agarwal.get("/api/account/summary?party=Mehta%20%26%20Sons").expect(404);
  await agarwal.get("/api/accounts").expect(403);
  const list = (await staff.get("/api/accounts")).body;
  assert.deepEqual(list.accounts.map((a) => [a.party, a.balance, a.overdue]), [["Agarwal Hosiery", 16000, 8000]]);
  await staff.get("/api/account/summary?party=Mehta%20%26%20Sons").expect(200);
  const home = (await agarwal.get("/api/my/home")).body.account;
  assert.deepEqual([home.balance, home.overdue, home.recent_bills.length], [16000, 8000, 3]);
});

test("a payment the distributor told us about is confirmed when the receipt reaches Tally", async () => {
  await sendAccounts();
  const told = (await agarwal.post("/api/my/payments").send({ amount: 7000, mode: "NEFT / RTGS", reference: "UTIB999",
    paid_on: day(-1) }).expect(200)).body;
  const wrong = (await agarwal.post("/api/my/payments").send({ amount: 123, mode: "Cash", paid_on: day(-1) }).expect(200)).body;
  await request(app).post("/api/bridge/accounts").set(BRIDGE).send({ from: day(-1), to: today(),
    entries: [RECEIPT("R/2", today(), 7000, "SNJ/2", "NEFT UTIB999")] }).expect(200)
    .then((r) => assert.equal(r.body.payments_confirmed, 1));
  const mine = (await agarwal.get("/api/my/payments")).body.payments;
  const byId = new Map(mine.map((p) => [p.id, p]));
  assert.equal(byId.get(told.id).status, "accepted");
  assert.match(byId.get(told.id).staff_note, /Receipt R\/2/);
  assert.equal(byId.get(wrong.id).status, "open");
  // Sending the same days again doesn't confirm another payment with the same receipt.
  await agarwal.post("/api/my/payments").send({ amount: 7000, mode: "UPI", reference: "x1", paid_on: day(-1) }).expect(200);
  await request(app).post("/api/bridge/accounts").set(BRIDGE).send({ from: day(-1), to: today(),
    entries: [RECEIPT("R/2", today(), 7000, "SNJ/2")] }).expect(200).then((r) => assert.equal(r.body.payments_confirmed, 0));
});

test("balance confirmation", async () => {
  await sendAccounts();
  await agarwal.post("/api/account/confirm").send({ agree: false }).expect(400);
  await agarwal.post("/api/account/confirm").send({ agree: true }).expect(200);
  await staff.post("/api/account/confirm?party=Agarwal%20Hosiery").send({ agree: true }).expect(403);
  const list = (await staff.get("/api/accounts")).body.accounts;
  assert.deepEqual(list[0].confirmed.agree, true);
});
