// app/api/pay/[piId]/route.js
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { dbConnect, PaySession } from "@/lib/db";

export async function GET(_req, context) {
  try {
    await dbConnect();
    const { piId } = await context.params;

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });
    const pi = await stripe.paymentIntents.retrieve(piId);

    const status = pi.status;
    await PaySession.findOneAndUpdate(
      { paymentIntentId: piId },
      { status },
      { new: true }
    );

    return NextResponse.json({ ok: true, status, piId });
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e.message || "PAY_STATUS_FAILED" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req, context) {
  try {
    await dbConnect();
    const { piId } = await context.params;

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    let pi = await stripe.paymentIntents.retrieve(piId).catch(() => null);

    // ถ้ายังไม่ success/canceled ให้ลอง cancel
    if (pi && !["succeeded", "canceled"].includes(pi.status)) {
      try {
        pi = await stripe.paymentIntents.cancel(piId);
      } catch (e) {
        // บางสถานะอาจยกเลิกไม่ได้ ก็ข้ามไป mark expired ฝั่ง DB
      }
    }

    await PaySession.findOneAndUpdate(
      { paymentIntentId: piId },
      { status: "canceled", expired: true, expiredAt: new Date() },
      { new: true }
    );

    return NextResponse.json({ ok: true, status: "canceled", expired: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e.message || "PAY_EXPIRE_FAILED" },
      { status: 500 }
    );
  }
}
