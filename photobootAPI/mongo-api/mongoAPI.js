// server.js
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import cors from 'cors';

const app = express();
const raw = process.env.CORS_ALLOW_ORIGINS || "";
const allowlist = raw.split(",").map(s => s.trim()).filter(Boolean);
const allowNoOrigin = true;

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return allowNoOrigin ? cb(null, true) : cb(new Error("CORS: Origin required"), false);
    if (allowlist.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`), false);
  },
  methods: ["GET","HEAD","POST","PATCH","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  credentials: false,
};

app.use(express.json());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.get('/health', (_req, res) => res.json({ ok: true })); // คงไว้ตามเดิม

// ====== Mongo URI  ======
const uri = process.env.MONGODB_URI;
const port = process.env.MONGODB_PORT; // คงไว้ตามเดิม
if (!uri) {
  console.warn('⚠️ Missing some Check .env file.');
}
console.log('[ENV]', { uri , port});

// ====== Connect DB ======
await mongoose.connect(uri, { autoIndex: true });
console.log('✅ MongoDB connected');
console.log('DB:', mongoose.connection.name);
console.log('Collections:', Object.keys(mongoose.connection.collections));

// =============================================================
// ===============   USER: Schema & Endpoints   ================
// =============================================================
const UserSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true, index: true },
    pin: { type: String, required: true },
    file_address: { type: [String], alias: 'flie_addr', default: [] },
    nextcloud_link: { type: String, default: null },
    gmail: {
      type: String,
      lowercase: true,
      trim: true,
    },
    consented: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false, collection: 'user' }
);

// ใช้ partial unique index (แทน unique+sparse) — index เฉพาะเอกสารที่ gmail เป็น string จริง ๆ
UserSchema.index(
  { gmail: 1 },
  {
    unique: true,
    partialFilterExpression: { gmail: { $type: "string" } }
  }
);

UserSchema.pre('save', async function (next) {
  if (!this.isModified('pin')) return next();
  const salt = await bcrypt.genSalt(10);
  this.pin = await bcrypt.hash(this.pin, salt);
  next();
});

UserSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate() || {};
  const newPin = update.pin ?? (update.$set && update.$set.pin) ?? null;
  if (newPin) {
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(String(newPin), salt);
    if (update.$set && 'pin' in update.$set) {
      update.$set.pin = hashed;
    } else if ('pin' in update) {
      update.pin = hashed;
    } else {
      this.setUpdate({ ...update, $set: { ...(update.$set || {}), pin: hashed } });
    }
  }
  next();
});

UserSchema.methods.comparePin = function (rawPin) {
  return bcrypt.compare(String(rawPin), this.pin);
};

const User = mongoose.model('User', UserSchema);

// ===== Auto-migration ตอนบูท =====
// - ลบ index gmail เดิม (ถ้าเคยสร้างไว้แบบ unique+sparse)
// - เอาฟิลด์ gmail:null ออก (ให้ฟิลด์หายไปเลย)
// - สร้าง partial unique index ใหม่
(async () => {
  try {
    try { await User.collection.dropIndex('gmail_1'); } catch {}
    await User.updateMany({ gmail: null }, { $unset: { gmail: "" } });
    try {
      await User.collection.createIndex(
        { gmail: 1 },
        { unique: true, partialFilterExpression: { gmail: { $type: "string" } } }
      );
    } catch {}
    console.log('🛠️ User.gmail index migrated');
  } catch (e) {
    console.warn('⚠️ Migration warning:', e?.message || e);
  }
})();

// --------------------- USER Endpoints ---------------------
// 1) ค้นหาด้วยเบอร์ + นับไฟล์ + เอาไฟล์แรก
app.get('/api/user/by-number/:number', async (req, res) => {
  try {
    const doc = await User.findOne({ number: String(req.params.number) }).lean();
    if (!doc) return res.status(404).json({ ok: false, message: 'User_not_found' });

    const files = Array.isArray(doc.file_address) ? doc.file_address : [];
    return res.json({ ok: true, data: doc, file_summary: { count: files.length, first: files[0] ?? null } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'server error' });
  }
});

// --------- GALLERY (robust previews with fallbacks) ---------
app.get('/api/user/:number/gallery', async (req, res) => {
  try {
    const number = String(req.params.number);
    const user = await User.findOne({ number }).lean();
    if (!user) return res.status(404).json({ ok: false, message: 'User_not_found' });

    const shareUrl = user.nextcloud_link || '';
    const files = Array.isArray(user.file_address) ? user.file_address : [];
    if (!shareUrl || files.length === 0) {
      return res.json({ ok: true, files: [] });
    }

    let u;
    try { u = new URL(shareUrl); } catch { return res.json({ ok: true, files: [] }); }
    const parts = u.pathname.split('/').filter(Boolean);
    const token = parts[parts.length - 1] || '';
    if (!token) return res.json({ ok: true, files: [] });

    const origin = `${u.protocol}//${u.host}`;

    const cleanRelPath = (p) => {
      const s = String(p).trim().replace(/^https?:\/\/[^/]+/i, '');
      const davPrefix = /^\/?remote\.php\/dav\/files\/[^/]+\//i;
      if (davPrefix.test(s)) return s.replace(davPrefix, '').replace(/^\/+/, '');
      return s.replace(/^\/+/, '');
    };

    const encSegs = (rel) => rel.split('/').filter(Boolean).map(encodeURIComponent).join('%2F');
    const splitNameParent = (rel) => {
      const segs = rel.split('/').filter(Boolean);
      const name = segs.pop() || '';
      const parent = segs.join('/');
      return { name, parent };
    };

    const items = files.map((p) => {
      const rel = cleanRelPath(p);
      const { name, parent } = splitNameParent(rel);

      const fileParam = `%2F${encSegs(rel)}`;                       // "/Folder/file.jpg"
      const pathParam = parent ? `%2F${encSegs(parent)}` : '%2F';    // "/Folder" หรือ "/"

      const previews = [
        `${origin}/index.php/core/preview.png?file=${fileParam}&x=512&y=512&a=1&mode=cover&t=${encodeURIComponent(token)}`,
        `${origin}/index.php/apps/files_sharing/ajax/publicpreview.php?x=512&y=512&a=1&t=${encodeURIComponent(token)}&file=${fileParam}`,
        `${origin}/s/${encodeURIComponent(token)}/preview?file=${fileParam}&x=512&y=512&a=1`,
      ];

      const downloadUrl = `${origin}/s/${encodeURIComponent(token)}/download?path=${pathParam}&files=${encodeURIComponent(name)}`;

      return { name, path: rel, previews, downloadUrl };
    });

    res.json({ ok: true, files: items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'server error' });
  }
});

// 2) สร้างผู้ใช้ใหม่ (PIN จะถูก hash อัตโนมัติ) — ปรับให้ไม่เซ็ต gmail ถ้าไม่ได้ส่ง และ map duplicate ให้ตรงฟิลด์
app.post('/api/user', async (req, res) => {
  try {
    const { number, pin, file_address, flie_addr, nextcloud_link, gmail } = req.body;
    if (!number || !pin) return res.status(400).json({ ok: false, message: 'Must have number and pin' });

    const files = Array.isArray(file_address) ? file_address : Array.isArray(flie_addr) ? flie_addr : [];

    const payload = {
      number: String(number),
      pin: String(pin),
      file_address: files.map(String),
      nextcloud_link: typeof nextcloud_link === 'string' ? nextcloud_link : null
    };

    // ใส่ gmail เฉพาะเมื่อส่งมาและ valid
    if (gmail != null) {
      const g = String(gmail).trim().toLowerCase();
      payload.gmail = g;
    }

    const created = await User.create(payload);

    res.status(201).json({ ok: true, id: created._id, data: { number: created.number } });
  } catch (e) {
    if (e?.code === 11000) {
      const key = Object.keys(e.keyPattern || {})[0] || 'unique_key';
      const map = {
        number: 'This number already exists.',
        gmail:  'This gmail is already in use.'
      };
      return res.status(409).json({ ok: false, message: map[key] || 'Duplicate key.' });
    }
    console.error(e);
    res.status(500).json({ ok: false, message: 'server error' });
  }
});

// 3) เช็ค PIN
app.post('/api/user/check-pin', async (req, res) => {
  try {
    const { number, pin } = req.body;
    if (!number || !pin) return res.status(400).json({ ok: false, message: 'Must have number and pin' });

    const user = await User.findOne({ number: String(number) });
    if (!user) return res.status(404).json({ ok: false, message: 'Number not found' });

    const match = await user.comparePin(pin);
    return res.json({ ok: true, match });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'server error' });
  }
});

// 4) เพิ่มไฟล์ลง array file_address (append)
app.post('/api/user/:number/file-address', async (req, res) => {
  try {
    const { number } = req.params;
    const { file_address } = req.body;
    if (!file_address || (Array.isArray(file_address) && file_address.length === 0)) {
      return res.status(400).json({ ok: false, message: 'ต้องส่ง file_address (string หรือ array)' });
    }
    const toPush = Array.isArray(file_address) ? file_address : [file_address];

    const updated = await User.findOneAndUpdate(
      { number: String(number) },
      { $push: { file_address: { $each: toPush.map(String) } } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ ok: false, message: 'Number not found' });
    res.json({ ok: true, data: updated, added: toPush.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'server error' });
  }
});

// 5) อัปเดตค่า nextcloud_link (set)
app.patch('/api/user/:number/nextcloud-link', async (req, res) => {
  try {
    const { number } = req.params;
    const { nextcloud_link } = req.body;

    if (typeof nextcloud_link !== 'string' || !nextcloud_link.trim()) {
      return res.status(400).json({ ok: false, message: 'nextcloud_link must be a non-empty string.' });
    }

    const updated = await User.findOneAndUpdate(
      { number: String(number) },
      { $set: { nextcloud_link: nextcloud_link.trim() } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ ok: false, message: 'Number not found' });
    res.json({ ok: true, data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'server error' });
  }
});

// 6) เปลี่ยน PIN
app.patch('/api/user/:number/pin', async (req, res) => {
  try {
    const { number } = req.params;
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ ok: false, message: 'You must send a new pin.' });
    const updated = await User.findOneAndUpdate(
      { number: String(number) },
      { $set: { pin: String(pin) } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ ok: false, message: 'Number not found' });
    res.json({ ok: true, message: 'PIN has been changed.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'server error' });
  }
});

app.put('/api/user/:number/gmail', async (req, res) => {
  try {
    const number = String(req.params.number);
    const raw = Object.prototype.hasOwnProperty.call(req.body, 'gmail') ? req.body.gmail : undefined;

    if (typeof number !== 'string' || !number.trim()) {
      return res.status(400).json({ ok: false, message: 'number (params) is required' });
    }
    if (raw === undefined) {
      return res.status(400).json({ ok: false, message: 'body.gmail is required (string or null)' });
    }

    const shouldRemove = raw === null || (typeof raw === 'string' && raw.trim() === '');
    let gmail = null;

    if (!shouldRemove) {
      gmail = String(raw).toLowerCase().trim();
    }

    const updated = await User.findOneAndUpdate(
      { number },
      { $set: { gmail } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ ok: false, message: 'User_not_found' });

    return res.json({
      ok: true,
      action: shouldRemove ? 'removed' : (updated.gmail ? 'set' : 'removed'),
      data: { number: updated.number, gmail: updated.gmail },
    });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ ok: false, message: 'gmail is already in use' });
    }
    console.error(e);
    return res.status(500).json({ ok: false, message: 'server error' });
  }
});

// ===== Set consented =====
app.put('/api/user/:number/consented/true', async (req, res) => {
  try {
    const number = String(req.params.number || '').trim();
    if (!number) return res.status(400).json({ ok: false, message: 'number (params) is required' });

    const updated = await User.findOneAndUpdate(
      { number, consented: { $ne: true } },
      { $set: { consented: true } },
      { new: true }
    );

    if (!updated) {
      const exists = await User.findOne({ number }, { number: 1, consented: 1 }).lean();
      if (!exists) return res.status(404).json({ ok: false, message: 'User_not_found' });
      if (exists.consented === true) {
        return res.json({ ok: true, message: 'Already_true', data: { number: exists.number, consented: true } });
      }
      return res.status(304).json({ ok: false, message: 'Not_modified' });
    }

    return res.json({ ok: true, message: 'Set_to_true', data: { number: updated.number, consented: updated.consented } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: 'server error' });
  }
});

// =============================================================
// ==============   PROMO: Schema & Endpoints   ================
// =============================================================

// --- helpers ---
const nowUtc = () => new Date();
const normalizeCode = (s) => String(s || "").trim().toUpperCase();

function computeAutoActive(p) {
  const now = nowUtc();
  // หมดอายุ / ยังไม่เริ่ม
  if (p.start_at && now < p.start_at) return false;
  if (p.end_at && now > p.end_at) return false;
  // เต็มจำนวน
  if (typeof p.usage_limit === "number" && p.usage_limit > 0) {
    if (p.used_count >= p.usage_limit) return false;
  }
  // ถ้า owner ปิดเองให้เคารพค่าด้วย
  return p.is_active === true;
}

// --- schemas ---
const PromoSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    type: { type: String, enum: ["percent", "fixed"], required: true },
    value: { type: Number, required: true, min: 0 },
    start_at: { type: Date, default: null },
    end_at: { type: Date, default: null },
    usage_limit: { type: Number, default: 0 },
    per_user_limit: { type: Number, default: 1, min: 0 },
    used_count: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
    note: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false, collection: "promocodes" }
);

PromoSchema.index({ code: 1 }, { unique: true });

const PromoRedemptionSchema = new mongoose.Schema(
  {
    promo_code: { type: String, required: true, index: true },
    promo_id: { type: mongoose.Schema.Types.ObjectId, ref: "Promo", index: true },
    user_number: { type: String, required: true, index: true },
    redeemed_at: { type: Date, default: () => new Date() },
    amount_before: { type: Number, default: null },
    discount_amount: { type: Number, default: null },
    amount_after: { type: Number, default: null },
  },
  { timestamps: true, versionKey: false, collection: "promo_redemptions" }
);

const Promo = mongoose.model("Promo", PromoSchema);
const PromoRedemption = mongoose.model("PromoRedemption", PromoRedemptionSchema);
function describeDiscount(promo, amount) {
  // คำนวณจำนวนลด (ไม่บันทึก DB ใน /validate)
  const amt = typeof amount === "number" && amount >= 0 ? amount : null;
  let discount = null;
  if (amt != null) {
    if (promo.type === "percent") {
      discount = Math.floor((amt * Math.max(0, Math.min(100, promo.value))) / 100);
    } else {
      discount = Math.max(0, promo.value);
    }
    if (discount > amt) discount = amt; // ไม่ให้ติดลบ
  }
  return {
    type: promo.type,
    value: promo.value,
    amount_before: amt,
    discount_amount: discount,
    amount_after: amt != null && discount != null ? Math.max(0, amt - discount) : null,
  };
}

async function refreshAutoDeactivate(p) {
  const shouldBeActive = computeAutoActive(p);
  if (p.is_active !== shouldBeActive) {
    p.is_active = shouldBeActive;
    try { await p.save(); } catch {}
  }
  return p;
}

async function canUserRedeem(promo, user_number) {
  if (!computeAutoActive(promo)) return { ok: false, reason: "INACTIVE_OR_EXPIRED" };

  if (typeof promo.per_user_limit === "number" && promo.per_user_limit > 0) {
    const usedByUser = await PromoRedemption.countDocuments({
      promo_id: promo._id,
      user_number: String(user_number),
    });
    if (usedByUser >= promo.per_user_limit) {
      return { ok: false, reason: "PER_USER_LIMIT_REACHED" };
    }
  }
  return { ok: true };
}

// ===================================================================
// 1) Create promo (POST /api/promos)
// ===================================================================
app.post("/api/promos", async (req, res) => {
  try {
    const {
      code,
      type,           // "percent" | "fixed"
      value,
      start_at,       // ISO string
      end_at,         // ISO string
      usage_limit,    // 0 = unlimited
      per_user_limit, // 0 = unlimited per user
      is_active,      // default true
      note,
    } = req.body || {};

    if (!code || !type || value == null) {
      return res.status(400).json({ ok: false, message: "code, type, value are required" });
    }
    if (!["percent", "fixed"].includes(type)) {
      return res.status(400).json({ ok: false, message: "type must be 'percent' or 'fixed'" });
    }
    if (type === "percent" && (value < 0 || value > 100)) {
      return res.status(400).json({ ok: false, message: "percent value must be between 0-100" });
    }
    if (type === "fixed" && value < 0) {
      return res.status(400).json({ ok: false, message: "fixed value must be >= 0" });
    }

    const payload = {
      code: normalizeCode(code),
      type,
      value: Number(value),
      start_at: start_at ? new Date(start_at) : null,
      end_at: end_at ? new Date(end_at) : null,
      usage_limit: usage_limit == null ? 0 : Number(usage_limit),
      per_user_limit: per_user_limit == null ? 1 : Number(per_user_limit),
      is_active: typeof is_active === "boolean" ? is_active : true,
      note: String(note || ""),
    };

    const created = await Promo.create(payload);
    await refreshAutoDeactivate(created);

    return res.status(201).json({ ok: true, data: created });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ ok: false, message: "Duplicate code" });
    }
    console.error(e);
    res.status(500).json({ ok: false, message: "server error" });
  }
});

// ===================================================================
// 2) GET /api/promos?active=true   (list, filter active)
// ===================================================================
app.get("/api/promos", async (req, res) => {
  try {
    const { active } = req.query;
    const list = await Promo.find({}).sort({ createdAt: -1 }).lean();

    // อัปเดตสถานะอัตโนมัติแบบขณะอ่าน (best-effort)
    const now = nowUtc();
    const mapped = await Promise.all(
      list.map(async (p) => {
        const doc = await Promo.findById(p._id);
        await refreshAutoDeactivate(doc);
        return doc.toObject();
      })
    );

    let result = mapped;
    if (active === "true") result = result.filter((p) => computeAutoActive(p));
    if (active === "false") result = result.filter((p) => !computeAutoActive(p));

    return res.json({ ok: true, data: result, now });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "server error" });
  }
});

// ===================================================================
// 3) GET /api/promos/:code   (single)
// ===================================================================
app.get("/api/promos/:code", async (req, res) => {
  try {
    const code = normalizeCode(req.params.code);
    const promo = await Promo.findOne({ code });
    if (!promo) return res.status(404).json({ ok: false, message: "PROMO_NOT_FOUND" });
    await refreshAutoDeactivate(promo);
    return res.json({ ok: true, data: promo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "server error" });
  }
});

// ===================================================================
// 4) PATCH /api/promos/:code   (partial update)
// ===================================================================
app.patch("/api/promos/:code", async (req, res) => {
  try {
    const code = normalizeCode(req.params.code);
    const body = req.body || {};

    // จำกัดฟิลด์ที่อัปเดตได้
    const up = {};
    if (body.type && ["percent", "fixed"].includes(body.type)) up.type = body.type;
    if (body.value != null) up.value = Number(body.value);
    if (body.start_at !== undefined) up.start_at = body.start_at ? new Date(body.start_at) : null;
    if (body.end_at !== undefined) up.end_at = body.end_at ? new Date(body.end_at) : null;
    if (body.usage_limit != null) up.usage_limit = Number(body.usage_limit);
    if (body.per_user_limit != null) up.per_user_limit = Number(body.per_user_limit);
    if (typeof body.is_active === "boolean") up.is_active = body.is_active;
    if (body.note !== undefined) up.note = String(body.note || "");

    const promo = await Promo.findOneAndUpdate({ code }, { $set: up }, { new: true });
    if (!promo) return res.status(404).json({ ok: false, message: "PROMO_NOT_FOUND" });

    await refreshAutoDeactivate(promo);
    return res.json({ ok: true, data: promo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "server error" });
  }
});

// ===================================================================
// 5) POST /api/promos/:code/deactivate
// ===================================================================
app.post("/api/promos/:code/deactivate", async (req, res) => {
  try {
    const code = normalizeCode(req.params.code);
    const promo = await Promo.findOneAndUpdate({ code }, { $set: { is_active: false } }, { new: true });
    if (!promo) return res.status(404).json({ ok: false, message: "PROMO_NOT_FOUND" });
    return res.json({ ok: true, data: promo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "server error" });
  }
});

// ===================================================================
// 6) POST /api/promos/:code/validate   (no DB write)
// body: { user_number?: string, amount?: number }
// ===================================================================
app.post("/api/promos/:code/validate", async (req, res) => {
  try {
    const code = normalizeCode(req.params.code);
    const user_number =req.body?.user_number ?? req.body?.userNumber ?? req.body?.user ?? req.body?.number ?? null;
    const amountRaw =req.body?.amount ?? req.body?.orderAmount ?? req.body?.total ?? req.body?.price ?? null;
    const amount = amountRaw != null ? Number(amountRaw) : null;
    const promo = await Promo.findOne({ code });
    if (!promo) return res.status(404).json({ ok: false, message: "PROMO_NOT_FOUND" });

    await refreshAutoDeactivate(promo);
    if (!computeAutoActive(promo)) {
      return res.status(400).json({ ok: false, message: "INACTIVE_OR_EXPIRED" });
    }

    if (user_number) {
      const per = await canUserRedeem(promo, String(user_number));
      if (!per.ok) return res.status(400).json({ ok: false, message: per.reason });
    }

    const pricing = describeDiscount(promo, typeof amount === "number" ? amount : null);
    return res.json({ ok: true, data: { promo, pricing } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "server error" });
  }
});


// ===================================================================
// 7) POST /api/promos/:code/redeem   (write redemption + inc used_count)
// body: { user_number: string, amount?: number }
// ===================================================================
app.post("/api/promos/:code/redeem", async (req, res) => {
  try {
    const code = normalizeCode(req.params.code);
    const user_number = req.body?.user_number ?? req.body?.userNumber ?? req.body?.user ?? req.body?.number ?? null;

    if (!user_number) {
      return res.status(400).json({ ok: false, message: "user_number is required" });
    }

    const amountRaw = req.body?.amount ?? req.body?.orderAmount ?? req.body?.total ?? req.body?.price ?? null;
    const amount = amountRaw != null ? Number(amountRaw) : null;

    let promo = await Promo.findOne({ code });
    if (!promo) return res.status(404).json({ ok: false, message: "PROMO_NOT_FOUND" });

    await refreshAutoDeactivate(promo);
    if (!computeAutoActive(promo)) {
      return res.status(400).json({ ok: false, message: "INACTIVE_OR_EXPIRED" });
    }

    const per = await canUserRedeem(promo, String(user_number));
    if (!per.ok) return res.status(400).json({ ok: false, message: per.reason });

    if (promo.usage_limit > 0 && promo.used_count >= promo.usage_limit) {
      await refreshAutoDeactivate(promo);
      return res.status(400).json({ ok: false, message: "USAGE_LIMIT_REACHED" });
    }

    const pricing = describeDiscount(promo, typeof amount === "number" ? amount : null);

    const redemption = await PromoRedemption.create({
      promo_code: promo.code,
      promo_id: promo._id,
      user_number: String(user_number),
      amount_before: pricing.amount_before,
      discount_amount: pricing.discount_amount,
      amount_after: pricing.amount_after,
    });

    promo.used_count += 1;
    await promo.save();
    await refreshAutoDeactivate(promo);

    return res.status(201).json({ ok: true, data: { redemption, promo, pricing } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "server error" });
  }
});
// =============================================================
// ================   Health Check Endpoints   ==================
// =============================================================

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.head('/api/health', (_req, res) => res.status(200).end());

// ====== Start Server ======
app.listen(port, () => console.log(`🚀 Server running on http://localhost:${port}`));
