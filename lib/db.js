// lib/db.js
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/photobooth";

let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

export async function dbConnect() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      autoIndex: true,
      serverSelectionTimeoutMS: 5000,
    }).then(m => m);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

const PaySessionSchema = new mongoose.Schema({
  sessionId: { type: String, index: true, unique: true },   // uuid
  userNumber: String,
  promoCode: String,
  originalAmountTHB: Number,
  discountAmountTHB: Number,
  finalAmountTHB: Number,
  paymentIntentId: { type: String, index: true },
  status: { type: String, default: "created" }, // created|processing|succeeded|canceled|failed
  expiresAt: { type: Date, default: null },
  expired: { type: Boolean, default: false },
  expiredAt: { type: Date, default: null },

  redeemed: { type: Boolean, default: false },
  redeemAt: { type: Date, default: null },
  redeemResult: { type: Object, default: null },

  raw: Object,
}, { timestamps: true });

export const PaySession =
  mongoose.models.PaySession || mongoose.model("PaySession", PaySessionSchema);
