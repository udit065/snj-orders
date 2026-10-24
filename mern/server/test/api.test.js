// End-to-end tests of the API with a throwaway MongoDB. The sample is what the Python
// bridge reads from tests/fake_tally.py (regenerate with mern/server/test/make-sample.py).
// Without internet access to MongoDB's downloads, point MONGOMS_SYSTEM_BINARY at a mongod.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const db = require("../db");
const { createApp } = require("../app");
const sample = require("./fixtures/sample-sync.json");

let mongo;
let app;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await db.Order.syncIndexes();
  app = createApp({ bridgeToken: "secret-token", sessionSecret: "test" });
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await db.Order.syncIndexes();
  await db.setUser("ramesh", "Ramesh Kumar", "password123");
});

function sync(body, { gzip = true, token = "secret-token" } = {}) {
  const raw = Buffer.from(JSON.stringify({ synced_at: "2026-10-17T10:42:00+05:30", ...body }));
  const r = request(app).post("/api/sync").set("Authorization", `Bearer ${token}`)
    .set("Content-Type", "application/json").serialize((x) => x);  // send the bytes as they are
  return gzip ? r.set("Content-Encoding", "gzip").send(zlib.gzipSync(raw)) : r.send(raw);
}

async function signIn() {
  const agent = request.agent(app);
  await agent.post("/api/login").send({ username: "Ramesh", password: "password123" }).expect(200);
  return agent;
}

test("bridge token is required", async () => {
  await sync({}, { token: "wrong" }).expect(401);
});

test("orders show what is sent and left, by size", async () => {
  const r = await sync({ full: true, ...sample }).expect(200);
  assert.deepEqual(r.body, { orders: 4, fulfilments: 4, has_full: true, run: null });

  await request(app).get("/api/orders/sales").expect(401);
  await request(app).post("/api/login").send({ username: "ramesh", password: "nope" }).expect(401);
  const agent = await signIn();

  const open = (await agent.get("/api/orders/sales").expect(200)).body;
  const parties = open.orders.map((o) => o.party);
  assert.ok(parties.includes("Agarwal Hosiery") && parties.includes("Mehta & Sons"));
  assert.ok(!parties.some((p) => /Dhanlaxmi/i.test(p)));  // cancelled hidden by default
  const agarwal = open.orders.find((o) => o.party === "Agarwal Hosiery");
  assert.equal(agarwal.status_label, "Partly done");
  assert.equal(agarwal.total, 21600);
  assert.equal(open.synced_at, "2026-10-17T10:42:00+05:30");
  assert.equal(open.counts.cancelled, 1);
  const cancelled = (await agent.get("/api/orders/sales?status=cancelled")).body.orders;
  assert.ok(/Dhanlaxmi/i.test(cancelled[0].party));

  const purchases = (await agent.get("/api/orders/purchase?status=all")).body.orders;
  assert.equal(purchases[0].status, "done");
  assert.equal(purchases[0].total, 155000);
  assert.equal((await agent.get("/api/orders/purchase")).body.orders.length, 0);  // completed hidden

  const found = (await agent.get("/api/orders/sales").query({ q: "niker xxl" })).body.orders.map((o) => o.party);
  assert.deepEqual(found, ["Mehta & Sons"]);

  const detail = (await agent.get("/api/order/g-so-1").expect(200)).body;
  assert.ok(detail.history.some((h) => h.voucher === "GST Sales SNJ/26-27/2201"));
  // bra: size 32 fully sent, size 34 has 2 of 3 left; niker 36: 4 of 6 left
  const left = detail.items.flatMap((g) => [g.left, ...g.sizes.map((s) => s.left)]);
  assert.deepEqual(left, [2, 0, 2, 4, 4]);
  await agent.get("/api/order/nope").expect(404);
});

test("a quick sync replaces only its own days", async () => {
  await sync({ full: true, ...sample });
  const withoutMehta = sample.orders.filter((o) => o.number !== "SO/26-27/0420");
  const r = await sync({ full: false, from: "2026-10-14", to: "2026-10-16", orders: withoutMehta.filter(
    (o) => o.date >= "2026-10-14" && o.date <= "2026-10-16"), fulfilments: sample.fulfilments.filter(
    (f) => f.date >= "2026-10-14" && f.date <= "2026-10-16") }, { gzip: false });
  assert.equal(r.body.has_full, true);
  const agent = await signIn();
  const parties = (await agent.get("/api/orders/sales?status=all")).body.orders.map((o) => o.party);
  assert.ok(!parties.includes("Mehta & Sons") && parties.includes("Agarwal Hosiery"));
  assert.ok((await agent.get("/api/order/g-so-1")).body.history.length > 0);
});

test("a full copy arrives month by month and only counts once complete", async () => {
  let r = await sync({ start_full: true, run: "run-1" });
  assert.deepEqual(r.body, { orders: 0, fulfilments: 0, has_full: false, run: "run-1" });
  await db.Order.create({ guid: "old", kind: "sales", number: "OLD/1", date: "2025-01-01", party: "Gone", lines: [] });
  await sync({ full: false, from: "2026-09-01", to: "2026-11-30", ...sample });
  r = await sync({ complete: true, run: "stale-run", from: "2026-06-01", to: "2026-12-31" });
  assert.equal(r.body.has_full, false);  // a complete for another run is ignored
  r = await sync({ complete: true, run: "run-1", from: "2026-06-01", to: "2026-12-31" });
  assert.equal(r.body.has_full, true);
  assert.equal(await db.Order.countDocuments({ guid: "old" }), 0);  // outside the period: dropped
  assert.equal(await db.Order.countDocuments(), 4);
});

test("signing out ends the session", async () => {
  const agent = await signIn();
  await agent.get("/api/me").expect(200);
  await agent.post("/api/logout").expect(200);
  await agent.get("/api/me").expect(401);
});
