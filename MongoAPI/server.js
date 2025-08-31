import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const app = express();
app.use(express.json());

// ====== Mongo URI  ======
const uri =
  process.env.MONGODB_URI ||
  'mongodb://admin:admin1234@s2pid.3bbddns.com:59081/photobooth?authSource=admin';

// ====== Connect DB ======
await mongoose.connect(uri, { autoIndex: true });
console.log('✅ MongoDB connected');
console.log('DB:', mongoose.connection.name);
console.log(
  'Collections:',
  Object.keys(mongoose.connection.collections)
);

// ====== Schema & Model ======
const UserSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true, index: true },
    pin: { type: String, required: true },
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
  const newPin =
    update.pin ?? (update.$set && update.$set.pin) ?? null;

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

// ===================== Endpoints =====================



// 1) ค้นหาด้วยเบอร์ + นับไฟล์ + เอาไฟล์แรก
app.get('/api/user/by-number/:number', async (req, res) => {
  try {
    const doc = await User.findOne({ number: String(req.params.number) }).lean();
    if (!doc) return res.status(404).json({ ok: false, message: 'User_not_found' });

    const files = Array.isArray(doc.file_address) ? doc.file_address : [];
    return res.json({
      ok: true,
      data: doc,
      file_summary: {
        count: files.length,
        first: files[0] ?? null
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'server error' });
  }
});


// 2) เพิ่มข้อมูล (สร้างผู้ใช้ใหม่) — PIN จะถูก hash อัตโนมัติ
app.post('/api/user', async (req, res) => {
  try {
    const { number, pin, file_address, flie_addr, nextcloud_linke } = req.body;
    if (!number || !pin) {
      return res.status(400).json({ ok: false, message: 'Must have number and pin' });
    }

    const files =
      Array.isArray(file_address) ? file_address :
      Array.isArray(flie_addr)    ? flie_addr    : [];

    const created = await User.create({
      number: String(number),
      pin: String(pin),
      file_address: files.map(String),
      nextcloud_linke: nextcloud_linke ?? null
    });

    res.status(201).json({ ok: true, id: created._id, data: { number: created.number } });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ ok: false, message: 'This number already exists.' });
    }
    console.error(e);
    res.status(500).json({ ok: false, message: 'server error' });
  }
});


// 3) เช็ค PIN (เทียบกับ hash)
app.post('/api/user/check-pin', async (req, res) => {
  try {
    const { number, pin } = req.body;
    if (!number || !pin) {
      return res.status(400).json({ ok: false, message: 'Must have number and pin' });
    }

    const user = await User.findOne({ number: String(number) });
    if (!user) return res.status(404).json({ ok: false, message: 'Number not found' });

    const match = await user.comparePin(pin);
    return res.json({ ok: true, match });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'server error' });
  }
});


// 4) เพิ่มไฟล์ลง array file_address ของหมายเลขนั้น ๆ (append)
app.post('/api/user/:number/file-address', async (req, res) => {
  try {
    const { number } = req.params;
    const { file_address } = req.body; // รับ string หรือ array

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

// 5) อัปเดตค่า nextcloud_link ของหมายเลขนั้น ๆ (set ทับ)
app.patch('/api/user/:number/nextcloud-link', async (req, res) => {
  try {
    const { number } = req.params;
    const { nextcloud_link } = req.body;

    if (typeof nextcloud_link !== 'string' || !nextcloud_link.trim()) {
      return res.status(400).json({ ok: false, message: 'nextcloud_linke must be passed as a string.' });
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

// ====== Start Server ======
const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`🚀 Server running on http://localhost:${port}`)
);
