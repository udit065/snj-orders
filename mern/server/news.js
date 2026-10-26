// Schemes, offers and news for distributors, and how to reach SNJ.
const express = require("express");
const db = require("./db");
const { today } = require("./orders");

const KINDS = { offer: "Scheme / offer", news: "News" };
const CONTACT_FIELDS = ["name", "phone", "whatsapp", "email", "hours"];

function view(p) {
  return { id: String(p._id), kind: p.kind, kind_label: KINDS[p.kind], title: p.title, body: p.body || "",
           until: p.until || "", photo: !!p.file_id, created_at: p.createdAt, by: p.by };
}

// What a distributor sees: offers that haven't ended, and news from the last 60 days.
async function currentPosts(limit = 50) {
  const since = new Date(Date.now() - 60 * 864e5);
  const posts = await db.Post.find({ $or: [
    { kind: "offer", $or: [{ until: "" }, { until: { $exists: false } }, { until: { $gte: today() } }] },
    { kind: "news", createdAt: { $gte: since } },
  ] }).sort({ createdAt: -1 }).limit(limit).lean();
  return posts.map(view);
}

async function getContact() {
  try {
    return JSON.parse(await db.getMeta("contact") || "{}");
  } catch {
    return {};
  }
}

function routes({ requireLogin, requireStaff }) {
  const r = express.Router();
  const staff = [requireLogin, requireStaff];

  r.get("/news", requireLogin, async (req, res) => {
    const isStaff = req.user.role === "staff";
    const posts = isStaff ? (await db.Post.find().sort({ createdAt: -1 }).limit(100).lean()).map(view) : await currentPosts();
    res.json({ posts, contact: await getContact(), can_post: isStaff, today: today() });
  });

  r.get("/news/:id/photo", requireLogin, async (req, res) => {
    const p = await db.Post.findById(req.params.id).lean().catch(() => null);
    if (!p || !p.file_id) return res.status(404).json({ detail: "Photo not found." });
    db.sendFile(res, p.file_id, p.content_type, `snj.${p.content_type.split("/")[1]}`);
  });

  r.post("/news", ...staff, express.json({ limit: "8mb" }), async (req, res) => {
    const b = req.body || {};
    const problems = [];
    const kind = KINDS[b.kind] ? b.kind : "";
    if (!kind) problems.push("Choose scheme / offer or news.");
    const title = String(b.title || "").trim().slice(0, 120);
    if (!title) problems.push("Give it a heading.");
    const body = String(b.body || "").trim().slice(0, 2000);
    const until = kind === "offer" && /^\d{4}-\d{2}-\d{2}$/.test(b.until || "") ? b.until : "";
    if (until && until < today()) problems.push("The end date has already passed.");
    let photo = null;
    if (b.photo) {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(String(b.photo));
      if (!m) problems.push("The picture must be JPEG, PNG or WebP.");
      else photo = { type: m[1], buffer: Buffer.from(m[2], "base64") };
    }
    if (problems.length) return res.status(400).json({ detail: problems.join(" "), problems });
    const fileId = photo ? await db.saveFile(photo.buffer, `post-${Date.now()}.${photo.type.split("/")[1]}`, photo.type) : undefined;
    const p = await db.Post.create({ kind, title, body, until, by: req.user.username, file_id: fileId,
                                     content_type: photo ? photo.type : undefined });
    res.json(view(p.toObject()));
  });

  r.delete("/news/:id", ...staff, async (req, res) => {
    const p = await db.Post.findByIdAndDelete(req.params.id).lean().catch(() => null);
    if (!p) return res.status(404).json({ detail: "Already removed." });
    if (p.file_id) await db.deleteFile(p.file_id);
    res.json({ ok: true });
  });

  r.post("/contact", ...staff, express.json(), async (req, res) => {
    const b = req.body || {};
    const contact = Object.fromEntries(CONTACT_FIELDS.map((k) => [k, String(b[k] || "").trim().slice(0, 120)]));
    for (const k of ["phone", "whatsapp"]) {
      const digits = contact[k].replace(/\D/g, "");
      if (contact[k] && digits.length < 10) return res.status(400).json({ detail: `Check the ${k === "phone" ? "phone" : "WhatsApp"} number.` });
    }
    await db.setMeta("contact", JSON.stringify(contact));
    res.json(contact);
  });

  return r;
}

module.exports = { routes, currentPosts, getContact };
