// app/api/stripe/webhook/route.js
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { dbConnect, PaySession } from "@/lib/db";

async function redeemPromoOnMongo({ code, userNumber, orderAmount }) {
  const base = process.env.NEXT_PUBLIC_MONGO_BASE?.replace(/\/$/, "");
  if (!base || !code || !userNumber)
    return { ok: false, message: "MONGO_BASE_OR_DATA_MISSING" };

  const r = await fetch(
    `${base}/api/promos/${encodeURIComponent(code)}/redeem`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userNumber, orderAmount }),
      cache: "no-store",
    }
  );
  const data = await r.json().catch(() => ({}));
  return r.ok && data?.ok !== false
    ? { ok: true, data }
    : { ok: false, data, status: r.status };
}

export async function POST(req) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20",
  });
  const sig = req.headers.get("stripe-signature");

  try {
    await dbConnect();
    const bodyBuffer = Buffer.from(await req.arrayBuffer());

    const event = stripe.webhooks.constructEvent(
      bodyBuffer,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    // อัปเดตสถานะ PI → DB ทุก event ที่เกี่ยวข้อง
    if (event.type.startsWith("payment_intent.")) {
      const pi = event.data.object;
      await PaySession.findOneAndUpdate(
        { paymentIntentId: pi.id },
        { status: pi.status },
        { upsert: false }
      );

      if (pi.status === "succeeded") {
        const sess = await PaySession.findOne({ paymentIntentId: pi.id });
        if (sess && !sess.redeemed) {
          const code = (pi.metadata?.promo_code || "").trim();
          const userNumber = (pi.metadata?.user_number || "").trim();
          const orderAmount = Number(
            pi.metadata?.original_thb || sess.originalAmountTHB || 50
          );

          if (code && userNumber) {
            const res = await redeemPromoOnMongo({
              code,
              userNumber,
              orderAmount,
            });
            await PaySession.updateOne(
              { _id: sess._id },
              { redeemed: !!res.ok, redeemAt: new Date(), redeemResult: res }
            );
          } else {
            // ไม่มีคูปอง ก็ข้ามไป
            await PaySession.updateOne(
              { _id: sess._id },
              {
                redeemed: false,
                redeemAt: new Date(),
                redeemResult: { ok: false, message: "NO_PROMO_TO_REDEEM" },
              }
            );
          }
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[webhook] error:", err);
    return NextResponse.json(
      { error: "Webhook Error", message: err.message },
      { status: 400 }
    );
  }
}
