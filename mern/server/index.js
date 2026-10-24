// Starts the website. Settings come from environment variables (see README).
const mongoose = require("mongoose");
const db = require("./db");
const { createApp } = require("./app");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Set MONGODB_URI to the MongoDB connection string");
  await mongoose.connect(uri);
  await db.Order.syncIndexes();
  await db.Fulfilment.syncIndexes();

  // STAFF_LOGINS="sidharth:Secret-Pass-1,ramesh:Other-Pass-2" (re-created at every start).
  for (const pair of (process.env.STAFF_LOGINS || "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const i = pair.indexOf(":");
    const [name, password] = i < 0 ? [pair, ""] : [pair.slice(0, i), pair.slice(i + 1)];
    if (name && password.length >= 8) await db.setUser(name, name[0].toUpperCase() + name.slice(1), password);
  }

  const app = createApp({
    bridgeToken: process.env.BRIDGE_TOKEN || "",
    sessionSecret: process.env.SESSION_SECRET,
    httpsOnly: process.env.HTTPS_ONLY === "1",
  });
  const port = process.env.PORT || 8000;
  app.listen(port, () => console.log(`SNJ Orders on port ${port}`));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
