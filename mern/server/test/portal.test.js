// The distributor portal: own data only, order-pad photos through to an entered order, the catalogue.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const db = require("../db");
const { createApp } = require("../app");
const sample = require("./fixtures/sample-sync.json");

let mongo;
let app;
const BRIDGE = { Authorization: "Bearer secret-token" };
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

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
  await db.Order.syncIndexes();
  await db.setUser("sidharth", "Sidharth", "password123");
  const raw = JSON.stringify({ synced_at: "2026-10-26T10:00:00+05:30", full: true, ...sample });
  await request(app).post("/api/sync").set(BRIDGE).set("Content-Type", "application/json").send(raw).expect(200);
});

async function signIn(username, password = "password123") {
  const agent = request.agent(app);
  await agent.post("/api/login").send({ username, password }).expect(200);
  return agent;
}

async function makeAgarwal(staff) {
  await staff.post("/api/distributors").send({ phone: "+91 98310 40404", name: "Agarwal Hosiery",
    parties: ["Agarwal Hosiery"], password: "agarwal-pass" }).expect(200);
  return signIn("9831040404", "agarwal-pass");
}

test("staff make distributor logins, checked against Tally's customers", async () => {
  const staff = await signIn("sidharth");
  let r = await staff.post("/api/distributors").send({ phone: "12345", name: "", parties: ["Nobody"] }).expect(400);
  assert.match(r.body.detail, /10-digit/);
  assert.match(r.body.detail, /Not a Tally customer: Nobody/);
  assert.match(r.body.detail, /password/);
  r = await staff.post("/api/distributors").send({ phone: "sidharth", name: "X", parties: ["Agarwal Hosiery"] }).expect(400);
  const agarwal = await makeAgarwal(staff);
  const list = (await staff.get("/api/distributors")).body;
  assert.deepEqual(list.distributors.map((d) => [d.phone, d.parties]), [["9831040404", ["Agarwal Hosiery"]]]);
  assert.ok(list.parties.includes("Mehta & Sons"));
  assert.equal((await agarwal.get("/api/me")).body.user.role, "distributor");

  // Switched off: the next request is signed out.
  await staff.post("/api/distributors").send({ phone: "9831040404", name: "Agarwal Hosiery",
    parties: ["Agarwal Hosiery"], active: false }).expect(200);
  await agarwal.get("/api/my/home").expect(401);
});

test("a distributor sees only their own orders", async () => {
  const staff = await signIn("sidharth");
  const agarwal = await makeAgarwal(staff);
  const home = (await agarwal.get("/api/my/home").expect(200)).body;
  assert.equal(home.open_orders, 1);
  assert.ok(home.coming_next.length > 0);
  assert.ok(home.coming_next.every((l) => l.left > 0));
  assert.ok(home.recent_orders.every((o) => o.party === "Agarwal Hosiery"));
  const mine = (await agarwal.get("/api/my/orders?status=all")).body.orders;
  assert.ok(mine.length && mine.every((o) => o.party === "Agarwal Hosiery"));
  await agarwal.get("/api/my/orders?q=Mehta").expect(200).then((r) => assert.equal(r.body.total, 0));

  // Staff pages and other customers' orders are closed to them.
  await agarwal.get("/api/orders/sales").expect(403);
  await agarwal.get("/api/orders/purchase").expect(403);
  await agarwal.get("/api/changes").expect(403);
  await agarwal.get("/api/masters").expect(403);
  await agarwal.get("/api/distributors").expect(403);
  await agarwal.get("/api/photo-orders").expect(403);
  await agarwal.get("/api/order/g-so-1").expect(200);
  const mehta = (await staff.get("/api/orders/sales?q=Mehta")).body.orders[0];
  await agarwal.get(`/api/order/${mehta.guid}`).expect(404);
  await staff.get("/api/my/home").expect(403);
});

test("an order-pad photo is entered by staff and followed through to Tally", async () => {
  const staff = await signIn("sidharth");
  const agarwal = await makeAgarwal(staff);
  await agarwal.post("/api/my/photos").set("Content-Type", "application/pdf").send(Buffer.from("%PDF-")).expect(400);
  const photo = (await agarwal.post("/api/my/photos?note=Urgent").set("Content-Type", "image/png").send(PNG).expect(200)).body;
  assert.equal(photo.stage, "received");
  assert.equal(photo.party, "Agarwal Hosiery");
  const img = await agarwal.get(`/api/photos/${photo.id}/image`).expect(200);
  assert.equal(img.headers["content-type"], "image/png");
  assert.equal(Buffer.compare(img.body, PNG), 0);

  // Another distributor can't see it.
  await staff.post("/api/distributors").send({ phone: "9876543210", name: "Mehta", parties: ["Mehta & Sons"],
    password: "mehta-pass" }).expect(200);
  const mehta = await signIn("9876543210", "mehta-pass");
  await mehta.get(`/api/photos/${photo.id}/image`).expect(404);
  assert.equal((await mehta.get("/api/my/photos")).body.photos.length, 0);

  const queue = (await staff.get("/api/photo-orders")).body;
  assert.equal(queue.open, 1);
  await request(app).post("/api/bridge/masters").set(BRIDGE).send({
    customers: [{ name: "Agarwal Hosiery", gstin: "19AAAPA1234A1Z5" }, { name: "Mehta & Sons", gstin: "" }],
    items: [{ name: "NIKER S-XL-(Doz)", unit: "Doz" }] }).expect(200);
  const order = { order_no: "SO/PH/1", date: "2026-10-26", party: "Agarwal Hosiery", photo_id: photo.id,
    lines: [{ item: "NIKER S-XL-(Doz)", rate: 2400, discount: "50+20", sizes: [{ size: "36", qty: 1, due_date: "2026-11-01" }] }] };
  let r = await staff.post("/api/changes").send({ ...order, party: "Mehta & Sons" }).expect(400);
  assert.match(r.body.detail, /photo is from Agarwal Hosiery/);
  const change = (await staff.post("/api/changes").send(order).expect(200)).body;
  let mine = (await agarwal.get("/api/my/photos")).body.photos[0];
  assert.deepEqual([mine.stage, mine.order_no], ["entered", "SO/PH/1"]);
  assert.equal((await staff.get("/api/photo-orders")).body.open, 0);

  await request(app).post(`/api/bridge/changes/${change.id}`).set(BRIDGE).send({ status: "sending" }).expect(200);
  await request(app).post(`/api/bridge/changes/${change.id}`).set(BRIDGE).send({ status: "done" }).expect(200);
  mine = (await agarwal.get("/api/my/photos")).body.photos[0];
  assert.equal(mine.stage, "done");

  // A photo that can't be entered is sent back with a reason.
  const second = (await agarwal.post("/api/my/photos").set("Content-Type", "image/png").send(PNG)).body;
  await staff.post(`/api/photo-orders/${second.id}/reject`).send({}).expect(400);
  await staff.post(`/api/photo-orders/${second.id}/reject`).send({ note: "Photo is blurred" }).expect(200);
  mine = (await agarwal.get("/api/my/photos")).body.photos[0];
  assert.deepEqual([mine.stage, mine.staff_note], ["rejected", "Photo is blurred"]);
});

test("staff upload catalogues and every login can open them", async () => {
  const staff = await signIn("sidharth");
  const agarwal = await makeAgarwal(staff);
  const pdf = Buffer.from("%PDF-1.4\n% test\n");
  await staff.post("/api/catalogue?title=").set("Content-Type", "application/pdf").send(pdf).expect(400);
  await staff.post("/api/catalogue?title=X").set("Content-Type", "application/pdf").send(Buffer.from("not pdf")).expect(400);
  await agarwal.post("/api/catalogue?title=X").set("Content-Type", "application/pdf").send(pdf).expect(403);
  const c = (await staff.post("/api/catalogue?title=Festive%202026").set("Content-Type", "application/pdf").send(pdf).expect(200)).body;
  const list = (await agarwal.get("/api/catalogue")).body;
  assert.deepEqual([list.catalogues[0].title, list.can_upload], ["Festive 2026", false]);
  const file = await agarwal.get(`/api/catalogue/${c.id}/file`).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on("data", (d) => chunks.push(d)).on("end", () => cb(null, Buffer.concat(chunks)));
  }).expect(200);
  assert.equal(Buffer.compare(file.body, pdf), 0);
  await agarwal.delete(`/api/catalogue/${c.id}`).expect(403);
  await staff.delete(`/api/catalogue/${c.id}`).expect(200);
  await agarwal.get(`/api/catalogue/${c.id}/file`).expect(404);
});
