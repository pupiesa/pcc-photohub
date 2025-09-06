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

app.get('/health', (_req, res) => res.json({ ok: true }));

// ====== Mongo URI  ======
const uri = process.env.MONGODB_URI;
const port = process.env.MONGODB_PORT;
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
    // NOTE: kept your alias typo compatibility (flie_addr) but primary field is file_address
    file_address: { type: [String], alias: 'flie_addr', default: [] },
    nextcloud_link: { type: String, default: null }
  },
  { timestamps: true, versionKey: false, collection: 'user' }
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

// 2) สร้างผู้ใช้ใหม่ (PIN จะถูก hash อัตโนมัติ)
app.post('/api/user', async (req, res) => {
  try {
    const { number, pin, file_address, flie_addr, nextcloud_link } = req.body;
    if (!number || !pin) return res.status(400).json({ ok: false, message: 'Must have number and pin' });

    const files = Array.isArray(file_address) ? file_address : Array.isArray(flie_addr) ? flie_addr : [];

    const created = await User.create({
      number: String(number),
      pin: String(pin),
      file_address: files.map(String),
      nextcloud_link: typeof nextcloud_link === 'string' ? nextcloud_link : null
    });

    res.status(201).json({ ok: true, id: created._id, data: { number: created.number } });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ ok: false, message: 'This number already exists.' });
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

// =============================================================
// ============   PROMO: Schemas & Endpoints   ================
// =============================================================
const PromoCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  type: { type: String, enum: ['percent','fixed'], required: true },
  value: { type: Number, required: true, min: 0 },
  start_at: { type: Date, required: true },
  end_at: { type: Date, required: true },
  usage_limit: { type: Number, required: true, min: 0 },
  used_count: { type: Number, default: 0, min: 0 },
  per_user_limit: { type: Number, default: 1, min: 0 },
  is_active: { type: Boolean, default: true }
}, { timestamps: true, collection: 'promocodes' });

const PromoCode = mongoose.model('PromoCode', PromoCodeSchema);

const PromoRedemptionSchema = new mongoose.Schema({
  promo_code: { type: String, index: true, required: true },
  user_number: { type: String, index: true, required: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, collection: 'promo_redemptions' });

const PromoRedemption = mongoose.model('promo_redemptions', PromoRedemptionSchema);

PromoCode.createIndexes();
PromoRedemption.createIndexes();

function withinDateRange(promo, now) { return promo.start_at <= now && promo.end_at >= now; }
function calcDiscount(promo, orderAmount) {
  if (promo.type === 'percent') return Math.floor(orderAmount * (promo.value / 100));
  return Math.min(orderAmount, promo.value);
}

async function validatePromoCore({ code, userNumber, orderAmount }) {
  const now = new Date();
  const promo = await PromoCode.findOne({ code, is_active: true });
  if (!promo) return { ok: false, reason: 'NOT_FOUND_OR_INACTIVE' };
  if (!withinDateRange(promo, now)) return { ok: false, reason: 'EXPIRED_OR_NOT_STARTED' };
  if (promo.used_count >= promo.usage_limit) return { ok: false, reason: 'GLOBAL_LIMIT_REACHED' };

  const usedByUser = await PromoRedemption.countDocuments({ promo_code: code, user_number: userNumber });
  if (promo.per_user_limit && usedByUser >= promo.per_user_limit) return { ok: false, reason: 'PER_USER_LIMIT_REACHED' };

  const discount = calcDiscount(promo, Number(orderAmount || 0));
  return { ok: true, promo, discount };
}

// --------------------- PROMO Endpoints ---------------------
// Create promo
app.post('/api/promos', async (req, res) => {
  try {
    const promo = await PromoCode.create(req.body || {});
    res.status(201).json({ ok: true, data: promo });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// List promos
app.get('/api/promos', async (req, res) => {
  try {
    const { active } = req.query;
    const filter = {};
    if (active === 'true') filter.is_active = true;
    const promos = await PromoCode.find(filter).sort({ createdAt: -1 });
    res.json({ ok: true, data: promos });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get one promo by code
app.get('/api/promos/:code', async (req, res) => {
  try {
    const promo = await PromoCode.findOne({ code: req.params.code });
    if (!promo) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    res.json({ ok: true, data: promo });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Update promo
app.patch('/api/promos/:code', async (req, res) => {
  try {
    const promo = await PromoCode.findOneAndUpdate(
      { code: req.params.code },
      { $set: req.body, $currentDate: { updatedAt: true } },
      { new: true }
    );
    if (!promo) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    res.json({ ok: true, data: promo });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Deactivate
app.post('/api/promos/:code/deactivate', async (req, res) => {
  try {
    const promo = await PromoCode.findOneAndUpdate(
      { code: req.params.code },
      { $set: { is_active: false } },
      { new: true }
    );
    if (!promo) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    res.json({ ok: true, data: promo });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Validate (no write)
app.post('/api/promos/:code/validate', async (req, res) => {
  try {
    const { userNumber, orderAmount } = req.body || {};
    if (!userNumber) return res.status(400).json({ ok:false, message:'userNumber required' });
    const result = await validatePromoCore({ code: req.params.code, userNumber, orderAmount });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Redeem (write minimal; small project: no transaction)
app.post('/api/promos/:code/redeem', async (req, res) => {
  try {
    const { userNumber, orderAmount } = req.body || {};
    if (!userNumber) return res.status(400).json({ ok:false, message:'userNumber required' });

    // (optional) ensure user exists
    const exists = await User.exists({ number: String(userNumber) });
    if (!exists) return res.status(404).json({ ok:false, message:'User_not_found' });

    const result = await validatePromoCore({ code: req.params.code, userNumber, orderAmount });
    if (!result.ok) return res.status(400).json(result);

    await PromoRedemption.create({ promo_code: req.params.code, user_number: userNumber });
    await PromoCode.updateOne({ code: req.params.code }, { $inc: { used_count: 1 } });

    res.json({ ok: true, discount: result.discount });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// ====== Start Server ======
app.listen(port, () => console.log(`🚀 Server running on http://localhost:${port}`));
