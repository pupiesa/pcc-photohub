// app/api/pay/route.js
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import { dbConnect, PaySession } from "@/lib/db";

const EXPIRE_SECONDS = Number(process.env.PAY_EXPIRE_SECONDS || 120);

// --- เรียก validate promo จาก mongo-api ---
async function validatePromoViaMongoApi({ code, userNumber, orderAmount }) {
  try {
    const base = process.env.NEXT_PUBLIC_MONGO_BASE?.replace(/\/$/, "");
    if (!base) return { ok: false };
    const r = await fetch(`${base}/api/promos/${encodeURIComponent(code)}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userNumber, orderAmount }),
      cache: "no-store",
    });
    const d = await r.json().catch(() => ({}));
    return d?.ok ? d : { ok: false, message: d?.message || "VALIDATE_FAILED" };
  } catch (e) {
    return { ok: false, message: e.message || "VALIDATE_ERROR" };
  }
}

// --- redeem promo (ใช้เมื่อ finalTHB = 0) ---
async function redeemPromoOnMongo({ code, userNumber, orderAmount }) {
  try {
    const base = process.env.NEXT_PUBLIC_MONGO_BASE?.replace(/\/$/, "");
    if (!base || !code || !userNumber) {
      return { ok: false, message: "MONGO_BASE_OR_DATA_MISSING" };
    }
    const r = await fetch(`${base}/api/promos/${encodeURIComponent(code)}/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userNumber, orderAmount }),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({}));
    return r.ok && data?.ok !== false
      ? { ok: true, data }
      : { ok: false, data, status: r.status };
  } catch (e) {
    return { ok: false, message: e.message || "REDEEM_ERROR" };
  }
}

const toSatang = (t) => Math.max(0, Math.round(Number(t) * 100));

// ดึงอีเมลผู้ใช้จาก mongo-api (ถ้ามี)
async function getUserEmailByNumber(userNumber) {
  try {
    const base = process.env.NEXT_PUBLIC_MONGO_BASE?.replace(/\/$/, "");
    if (!base || !userNumber) return null;
    const r = await fetch(`${base}/api/user/by-number/${encodeURIComponent(userNumber)}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    return d?.data?.gmail || null;
  } catch {
    return null;
  }
}

export async function POST(req) {
  try {
    await dbConnect();

    const body = await req.json().catch(() => ({}));
    const { promoCode, userNumber, orderAmount, email: emailFromBody } = body || {};
    const BASE_THB = Number(orderAmount || 50);

    // email
    let customerEmail = (emailFromBody || "").trim();
    if (!customerEmail) customerEmail = (await getUserEmailByNumber(userNumber)) || "";
    if (!customerEmail) customerEmail = `no-reply+${String(userNumber || "guest")}@pcc.local`;

    // ตรวจคูปอง + คำนวณส่วนลด
    let discountTHB = 0;
    let finalTHB = BASE_THB;

    if (promoCode) {
      const validated = await validatePromoViaMongoApi({
        code: promoCode, userNumber, orderAmount: BASE_THB,
      });
      if (!validated?.ok) {
        return NextResponse.json({ ok: false, message: "INVALID_COUPON" }, { status: 400 });
      }
      const pricing = validated?.data?.pricing;
      if (pricing && typeof pricing.amount_after === "number") {
        const before = Number(pricing.amount_before ?? BASE_THB);
        const disc = Math.max(0, Number(pricing.discount_amount || 0));
        const after = Math.max(0, Number(pricing.amount_after));
        discountTHB = disc;
        finalTHB = after;
      } else {
        // ปิดเคสเก่า: ถ้าไม่มี pricing ให้ถือว่าไม่ลด (กัน edge case)
        discountTHB = 0;
        finalTHB = BASE_THB;
      }
    }

    // กรณีคูปองทำให้ยอดสุดท้าย = 0 → ข้าม Stripe, mark succeeded + redeem คูปองทันที
    if (finalTHB <= 0) {
      const sessionId = uuidv4();

      // สร้าง PaySession แบบ “ฟรี”
      const created = await PaySession.create({
        sessionId,
        userNumber,
        promoCode: promoCode || null,
        originalAmountTHB: BASE_THB,
        discountAmountTHB: Math.max(discountTHB, BASE_THB),
        finalAmountTHB: 0,
        paymentIntentId: null,
        status: "succeeded",
        expiresAt: null,
        expired: false,
        expiredAt: null,
        raw: { free: true },
      });

      //redeem คูปองทันที (เพราะไม่มี webhook จาก Stripe)
      let redeemResult = { ok: false, message: "NO_PROMO_TO_REDEEM" };
      if (promoCode) {
        redeemResult = await redeemPromoOnMongo({
          code: promoCode,
          userNumber,
          orderAmount: BASE_THB,
        });
        await PaySession.updateOne(
          { _id: created._id },
          { redeemed: !!redeemResult.ok, redeemAt: new Date(), redeemResult }
        );
      }

      return NextResponse.json({
        ok: true,
        sessionId,
        paymentIntentId: null,
        amountTHB: 0,
        qr: null,
        clientSecret: null,
        expiresAt: null,
        expireSeconds: 0,
        free: true,
        redeemed: !!redeemResult.ok,
      });
    }

    //มียอดจริง → สร้าง PromptPay (Stripe)
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + EXPIRE_SECONDS * 1000);

    const pi = await stripe.paymentIntents.create({
      amount: toSatang(finalTHB),
      currency: "thb",
      payment_method_types: ["promptpay"],
      confirmation_method: "automatic",
      confirm: true,
      payment_method_data: {
        type: "promptpay",
        billing_details: { email: customerEmail },
      },
      receipt_email: customerEmail,
      metadata: {
        session_id: sessionId,
        user_number: String(userNumber || ""),
        promo_code: String(promoCode || ""),
        original_thb: String(BASE_THB),
        discount_thb: String(discountTHB),
        final_thb: String(finalTHB),
        expires_at: String(expiresAt.toISOString()),
      },
    });

    const na = pi.next_action || {};
    const qr =
      na?.display_qr_code?.image_url_png ||
      na?.promptpay_display_qr_code?.image_url_png ||
      null;

    await PaySession.create({
      sessionId,
      userNumber,
      promoCode: promoCode || null,
      originalAmountTHB: BASE_THB,
      discountAmountTHB: discountTHB,
      finalAmountTHB: finalTHB,
      paymentIntentId: pi.id,
      status: "created",
      expiresAt,
      expired: false,
      expiredAt: null,
      raw: { piId: pi.id, client_secret: pi.client_secret },
    });

    return NextResponse.json({
      ok: true,
      sessionId,
      paymentIntentId: pi.id,
      amountTHB: finalTHB,
      qr,
      clientSecret: pi.client_secret,
      expiresAt: expiresAt.toISOString(),
      expireSeconds: EXPIRE_SECONDS,
    });
  } catch (e) {
    if (process.env.STRIPE_TEST_MODE) console.error("[/api/pay] error:", e);
    return NextResponse.json({ ok: false, message: e.message || "PAY_CREATE_FAILED" }, { status: 500 });
  }
}
