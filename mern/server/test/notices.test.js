// Payments and damage claims: a distributor tells SNJ, staff accept or send back.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const db = require("../db");
const { createApp } = require("../app");
const { today } = require("../orders");
const sample = require("./fixtures/sample-sync.json");

let mongo;
let app;
const PNG = "data:image/png;base64," + Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64");

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = createApp({ bridgeToken: "secret-token", sessionSecret: "test" });
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await db.setUser("sidharth", "Sidharth", "password123");
  const raw = JSON.stringify({ synced_at: "2026-10-26T10:00:00+05:30", full: true, ...sample });
  await request(app).post("/api/sync").set({ Authorization: "Bearer secret-token" })
    .set("Content-Type", "application/json").send(raw).expect(200);
});

async function signIn(username, password) {
  const agent = request.agent(app);
  await agent.post("/api/login").send({ username, password }).expect(200);
  return agent;
}

async function agents() {
  const staff = await signIn("sidharth", "password123");
  for (const [phone, name, party] of [["9831040404", "Agarwal", "Agarwal Hosiery"], ["9876543210", "Mehta", "Mehta & Sons"]]) {
    await staff.post("/api/distributors").send({ phone, name, parties: [party], password: "dist-pass" }).expect(200);
  }
  return { staff, agarwal: await signIn("9831040404", "dist-pass"), mehta: await signIn("9876543210", "dist-pass") };
}

test("a payment is told, checked and confirmed", async () => {
  const { staff, agarwal, mehta } = await agents();
  let r = await agarwal.post("/api/my/payments").send({ amount: 0, mode: "UPI", paid_on: "2999-01-01" }).expect(400);
  assert.match(r.body.detail, /amount/);
  assert.match(r.body.detail, /future/);
  assert.match(r.body.detail, /UTR/);
  await agarwal.post("/api/my/payments").send({ amount: 5000, mode: "Cash", paid_on: today(), photos: ["data:text/html;base64,PGI+"] }).expect(400);
  const pay = (await agarwal.post("/api/my/payments").send({ amount: "25000.5", mode: "NEFT / RTGS", reference: "UTIB1234",
    paid_on: today(), photos: [PNG] }).expect(200)).body;
  assert.deepEqual([pay.amount, pay.party, pay.status, pay.photos], [25000.5, "Agarwal Hosiery", "open", 1]);
  await agarwal.get(`/api/notices/${pay.id}/photo/0`).expect(200).expect("content-type", "image/png");
  await mehta.get(`/api/notices/${pay.id}/photo/0`).expect(404);
  assert.equal((await mehta.get("/api/my/payments")).body.payments.length, 0);

  await agarwal.get("/api/payments").expect(403);
  await agarwal.post(`/api/payments/${pay.id}`).send({ decision: "accepted" }).expect(403);
  const list = (await staff.get("/api/payments")).body;
  assert.equal(list.open, 1);
  await staff.post(`/api/payments/${pay.id}`).send({ decision: "rejected" }).expect(400);
  await staff.post(`/api/claims/${pay.id}`).send({ decision: "accepted" }).expect(409);  // wrong kind
  await staff.post(`/api/payments/${pay.id}`).send({ decision: "accepted", note: "Receipt R/88" }).expect(200);
  await staff.post(`/api/payments/${pay.id}`).send({ decision: "rejected", note: "x" }).expect(409);
  const mine = (await agarwal.get("/api/my/payments")).body.payments[0];
  assert.deepEqual([mine.status, mine.stage_label, mine.staff_note], ["accepted", "Received by SNJ", "Receipt R/88"]);
  assert.equal((await staff.get("/api/payments")).body.open, 0);
  assert.equal((await staff.get("/api/payments?show=all")).body.payments.length, 1);
});

test("a damage claim needs a photo and can name one of their orders", async () => {
  const { staff, agarwal } = await agents();
  const form = (await agarwal.get("/api/my/claims")).body;
  assert.ok(form.orders.length && form.orders.every((o) => o.party === "Agarwal Hosiery"));
  const mehtaOrder = (await staff.get("/api/orders/sales?q=Mehta")).body.orders[0];
  let r = await agarwal.post("/api/my/claims").send({ problem: "Damaged", item: "NIKER", order_guid: mehtaOrder.guid }).expect(400);
  assert.match(r.body.detail, /own orders/);
  assert.match(r.body.detail, /photo/);
  const claim = (await agarwal.post("/api/my/claims").send({ problem: "Short", order_guid: form.orders[0].guid,
    item: form.orders[0].items[0], qty: 2, photos: [PNG, PNG, PNG, PNG] }).expect(200)).body;
  assert.deepEqual([claim.photos, claim.order.number, claim.qty], [3, form.orders[0].number, 2]);
  const queue = (await staff.get("/api/claims")).body;
  assert.deepEqual([queue.open, queue.claims[0].problem], [1, "Short"]);
  await staff.post(`/api/claims/${claim.id}`).send({ decision: "accepted", note: "Credit note CN/12" }).expect(200);
  assert.equal((await agarwal.get("/api/my/claims")).body.claims[0].stage_label, "Accepted");
  // The portal's own /my pages still work beside these.
  await agarwal.get("/api/my/home").expect(200);
});

test("staff post offers and news; distributors see current ones and SNJ's contact", async () => {
  const { staff, agarwal } = await agents();
  await agarwal.post("/api/news").send({ kind: "news", title: "x" }).expect(403);
  let r = await staff.post("/api/news").send({ kind: "offer", title: "", until: "2000-01-01" }).expect(400);
  assert.match(r.body.detail, /heading/);
  assert.match(r.body.detail, /passed/);
  const offer = (await staff.post("/api/news").send({ kind: "offer", title: "Diwali scheme", body: "5% extra on 100 doz",
    until: "2999-12-31", photo: PNG }).expect(200)).body;
  await staff.post("/api/news").send({ kind: "news", title: "New thermal range" }).expect(200);
  // An offer that has ended disappears for distributors.
  await db.Post.create({ kind: "offer", title: "Old scheme", until: "2020-01-01" });
  const seen = (await agarwal.get("/api/news")).body;
  assert.deepEqual(seen.posts.map((p) => p.title).sort(), ["Diwali scheme", "New thermal range"]);
  assert.equal(seen.can_post, false);
  await agarwal.get(`/api/news/${offer.id}/photo`).expect(200).expect("content-type", "image/png");
  assert.equal((await staff.get("/api/news")).body.posts.length, 3);

  await staff.post("/api/contact").send({ phone: "123" }).expect(400);
  await agarwal.post("/api/contact").send({ phone: "9876543210" }).expect(403);
  await staff.post("/api/contact").send({ name: "Rohit (sales)", phone: "+91 98765 43210", whatsapp: "9876543210" }).expect(200);
  const home = (await agarwal.get("/api/my/home")).body;
  assert.equal(home.contact.phone, "+91 98765 43210");
  assert.equal(home.posts.length, 2);
  await agarwal.delete(`/api/news/${offer.id}`).expect(403);
  await staff.delete(`/api/news/${offer.id}`).expect(200);
});
