// New orders: the form's lists from the bridge, checks, and the bridge's queue (no approval step).
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const db = require("../db");
const { createApp } = require("../app");

let mongo;
let app;
const BRIDGE = { Authorization: "Bearer secret-token" };
const ORDER = {
  order_no: "SO/W1/1", date: "2026-10-24", party: "Mehta & Sons", narration: "By phone",
  lines: [{ item: "NIKER S-XL-(Doz)", rate: 2400, discount: "50+20",
            sizes: [{ size: "36", qty: 2.5, due_date: "2026-11-01" }, { size: "38", qty: 1, due_date: "2026-11-05" }] }],
};

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
  await db.setUser("ramesh", "Ramesh", "password123");
  await db.setUser("sidharth", "Sidharth", "password123");
});

async function signIn(username) {
  const agent = request.agent(app);
  await agent.post("/api/login").send({ username, password: "password123" }).expect(200);
  return agent;
}

const sendMasters = () => request(app).post("/api/bridge/masters").set(BRIDGE).send({
  customers: [{ name: "Mehta & Sons", gstin: "08AAAPM1234A1Z5" }],
  items: [{ name: "NIKER S-XL-(Doz)", unit: "Doz" }],
}).expect(200);

test("orders are checked against Tally's lists", async () => {
  const ramesh = await signIn("ramesh");
  let r = await ramesh.post("/api/changes").send(ORDER).expect(400);
  assert.match(r.body.detail, /haven't arrived from Tally/);
  await sendMasters();
  assert.equal((await ramesh.get("/api/masters")).body.items[0].unit, "Doz");
  r = await ramesh.post("/api/changes").send({ ...ORDER, party: "Mehta and Sons",
    lines: [{ ...ORDER.lines[0], rate: 0, sizes: [{ size: "36", qty: 0, due_date: "" }] }] }).expect(400);
  assert.match(r.body.detail, /customer/);
  assert.match(r.body.detail, /rate/);
  assert.match(r.body.detail, /quantity/);
  assert.match(r.body.detail, /due date/);
  await db.Order.create({ guid: "x", kind: "sales", number: "SO/OLD/1", date: "2026-10-01", party: "A", lines: [] });
  r = await ramesh.post("/api/changes").send({ ...ORDER, order_no: "SO/OLD/1" }).expect(400);
  assert.match(r.body.detail, /already used/);
});

test("a new order goes straight to the bridge's queue, is picked up once, and logged", async () => {
  await sendMasters();
  const ramesh = await signIn("ramesh");
  const made = (await ramesh.post("/api/changes").send(ORDER).expect(200)).body;
  assert.equal(made.status, "waiting");
  assert.equal(made.total, 3360);  // 2400 x 3.5 x 0.4
  assert.equal(made.order.lines[0].unit, "Doz");  // unit comes from Tally's item
  await ramesh.post("/api/changes").send(ORDER).expect(400);  // same number twice

  await ramesh.post(`/api/changes/${made.id}/approve`).expect(404);  // there is no approval step

  const sync = await request(app).post("/api/sync").set(BRIDGE).set("Content-Type", "application/json")
    .send(JSON.stringify({ status_only: true }));
  assert.equal(sync.body.changes_waiting, 1);
  assert.equal(sync.body.masters_stale, false);

  const queue = (await request(app).get("/api/bridge/changes").set(BRIDGE)).body;
  assert.equal(queue.length, 1);
  assert.equal(queue[0].order.party, "Mehta & Sons");
  await request(app).post(`/api/bridge/changes/${made.id}`).set(BRIDGE).send({ status: "sending" }).expect(200);
  await request(app).post(`/api/bridge/changes/${made.id}`).set(BRIDGE).send({ status: "sending" }).expect(409);
  await ramesh.post(`/api/changes/${made.id}/withdraw`).expect(409);  // too late once sending
  await request(app).post(`/api/bridge/changes/${made.id}`).set(BRIDGE).send({ status: "done" }).expect(200);

  const list = (await ramesh.get("/api/changes")).body;
  const c = list.changes[0];
  assert.equal(c.status_label, "In Tally");
  assert.deepEqual(c.history.map((h) => [h.by, h.status]), [
    ["ramesh", "waiting"], ["bridge", "sending"], ["bridge", "done"]]);
});

test("the bridge can report a failure, and staff can withdraw before sending", async () => {
  await sendMasters();
  const sidharth = await signIn("sidharth");
  const a = (await sidharth.post("/api/changes").send(ORDER)).body;
  await request(app).post(`/api/bridge/changes/${a.id}`).set(BRIDGE)
    .send({ status: "failed", error: "Not in Tally (SNJ TEST): item 'X'" }).expect(200);
  const b = (await sidharth.post("/api/changes").send(ORDER).expect(200)).body;  // number is free again
  const ramesh = await signIn("ramesh");
  await ramesh.post(`/api/changes/${b.id}/withdraw`).expect(200);  // anyone, until the bridge takes it
  await ramesh.post(`/api/changes/${b.id}/withdraw`).expect(409);
  const list = (await sidharth.get("/api/changes")).body.changes;
  assert.deepEqual(list.map((c) => c.status), ["withdrawn", "failed"]);
  assert.match(list[1].error, /SNJ TEST/);
  await request(app).post("/api/bridge/changes/nope").set(BRIDGE).send({ status: "done" }).expect(409);
  await request(app).get("/api/bridge/changes").expect(401);
});
