// email-otp-api.js (fixed)
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import dayjs from 'dayjs';

// ---------- CONFIG ----------
const PORT = Number(process.env.SMTP_PORT || 3301);
const MONGODB_URI = process.env.MONGODB_URI;

const OTP_TTL_MIN = Number(process.env.OTP_TTL_MIN || 10);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const REQUEST_COOLDOWN_SEC = Number(process.env.REQUEST_COOLDOWN_SEC || 60);

const FROM_NAME = process.env.FROM_NAME || 'No-Reply';
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.SMTP_USER;

// ---------- MAILER ----------
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
});
async function sendMail({ to, subject, html, text }) {
  return transporter.sendMail({ from: `"${FROM_NAME}" <${FROM_EMAIL}>`, to, subject, html, text });
}

// ---------- DB MODELS ----------
const UserSchemaLoose = new mongoose.Schema({}, { collection: 'user', strict: false });
const User = mongoose.models.User || mongoose.model('User', UserSchemaLoose, 'user');

const EmailOTPSchema = new mongoose.Schema({
  userId: { type: mongoose.Types.ObjectId, required: true, index: true },
  number: { type: String, required: true, index: true },
  email:  { type: String, required: true, index: true },
  otpHash:{ type: String, required: true },
  // อย่าใส่ index:true ตรงนี้ (กันชนกับ TTL)
  expiresAt: { type: Date, required: true },
  used: { type: Boolean, default: false, index: true },
  attempts: { type: Number, default: 0 },
  lastRequestAt: { type: Date, default: () => new Date() },
  meta: { type: Object },
}, { timestamps: true });

// *** ตัดบรรทัดนี้ทิ้งจากเวอร์ชันก่อน ***
// EmailOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const EmailOTP = mongoose.model('EmailOTP', EmailOTPSchema);

// ---------- HELPERS ----------
const hash = (s) => bcrypt.hash(s, 10);
const genOTP = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
const now = () => new Date();
const normalizeEmail = (e = '') => e.trim().toLowerCase();
const isGmail = (e = '', domains = ['gmail.com', 'kmitl.ac.th']) => {
  if (typeof e !== 'string') return false;
  const m = e.trim().toLowerCase().match(/^[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})$/i);
  if (!m) return false;                 // รูปแบบอีเมลไม่ถูก
  const domain = m[1];
  return domains.some(d => domain === d.toLowerCase());
};

// ---------- SERVER ----------
const app = express();
app.use(express.json());

app.get('/', (_, res) => res.send('Email OTP Verify API is running'));

// request
app.post('/email/verify/request', async (req, res) => {
  try {
    const number = String(req.body.number || '').trim();
    const email = normalizeEmail(req.body.email);
    const heading = req.body.heading || 'Verify your User';
    if (!number || !email) return res.status(400).json({ error: 'Number and Email required' });
    if (!isGmail(email)) return res.status(400).json({ error: 'Email must end with @gmail.com' });

    const user = await User.findOne({ number }).lean();
    if (!user?._id) return res.json({ ok: true }); // ปิดเผยข้อมูล

    const latest = await EmailOTP.findOne({ userId: user._id, number, email, used: false }).sort({ createdAt: -1 });
    if (latest && dayjs(latest.lastRequestAt).add(REQUEST_COOLDOWN_SEC, 'second').isAfter(dayjs())) {
      return res.json({ ok: true });
    }

    const otp = genOTP();
    await EmailOTP.create({
      userId: user._id,
      number,
      email,
      otpHash: await hash(otp),
      expiresAt: dayjs().add(OTP_TTL_MIN, 'minute').toDate(),
      used: false,
      attempts: 0,
      lastRequestAt: now(),
      meta: { ip: req.ip, ua: req.get('user-agent') },
    });

    try {
      await sendMail({
        to: email,
        from: { name: "PCC PhotoHub"},
        envelope: {
          from: "bounce@yourdomain.com",
          to: email
        },
        headers: {
          "Auto-Submitted": "auto-generated",
          "Precedence": "bulk",
          "X-Auto-Response-Suppress": "All",
          "List-Post": "NO",
          "X-No-Reply": "true"
        },
        subject: `Your verification code: ${otp}`,
        text: `Your verification code is ${otp}. It expires in ${OTP_TTL_MIN} minutes.`,
        html: `
          <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
            <h2>${heading}</h2>
            <p>Use this code within ${OTP_TTL_MIN} minutes:</p>
            <div style="font-size:28px;letter-spacing:4px;font-weight:700">${otp}</div>
            <p>If you didn't request this, you can ignore this email.</p>
          </div>
        `,
      });
    } catch (e) {
      console.error('Email send error:', e?.message || e);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// confirm
app.post('/email/verify/confirm', async (req, res) => {
  try {
    const number = String(req.body.number || '').trim();
    const email = normalizeEmail(req.body.email);
    const { otp } = req.body;
    if (!number || !email || !otp) return res.status(400).json({ error: 'Number, Email and OTP required' });
    if (!isGmail(email)) return res.status(400).json({ error: 'Email must end with @gmail.com' });

    const user = await User.findOne({ number }).lean();
    if (!user?._id) return res.status(400).json({ error: 'Invalid request' });

    const rec = await EmailOTP.findOne({
      userId: user._id, number, email, used: false, expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!rec) return res.status(400).json({ error: 'OTP expired or invalid' });
    if (rec.attempts >= OTP_MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many attempts. Request a new code.' });

    const ok = await bcrypt.compare(otp, rec.otpHash || '');
    if (!ok) {
      rec.attempts += 1; await rec.save();
      return res.status(400).json({ error: 'OTP incorrect' });
    }

    rec.used = true; await rec.save();

    try {
      const upd = await User.updateOne({ _id: user._id }, { $set: { gmail: email, emailVerified: true } });
      if (upd.modifiedCount === 0 && upd.matchedCount === 1) return res.json({ ok: true });
      return res.json({ ok: true });
    } catch (e) {
      if (e?.code === 11000) return res.status(409).json({ error: 'This gmail is already in use' });
      console.error('User update error:', e);
      return res.status(500).json({ error: 'Server error' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ---------- BOOT ----------
(async () => {
  try {
    await mongoose.connect(MONGODB_URI, { autoIndex: true });

    // สร้าง/แก้ไข TTL index ให้ถูกต้องแบบปลอดชน
    const coll = EmailOTP.collection;
    try {
      const idx = await coll.indexes();
      const ex = idx.find(i => i.key && i.key.expiresAt === 1);
      if (ex && typeof ex.expireAfterSeconds === 'undefined') {
        // มี index ชื่อ expiresAt_1 แต่ไม่ใช่ TTL -> ดรอปก่อน
        await coll.dropIndex(ex.name);
      }
    } catch (e) {
      console.warn('Index inspect/drop warn:', e?.message || e);
    }
    // สร้าง TTL index ด้วยชื่อเฉพาะ ป้องกันชนชื่อกับตัวเก่า
    try {
      await coll.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'emailotp_expiresAt_ttl_0s' });
    } catch (e) {
      if (e?.codeName !== 'IndexOptionsConflict') throw e;
      // ถ้าชนจริง ๆ ก็ข้ามไปเพราะมี TTL ที่เทียบเท่าอยู่แล้ว
    }

    app.listen(PORT, () => {
      console.log(`[OK] Email OTP Verify API listening on http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error('DB connect error:', e);
    process.exit(1);
  }
})();
