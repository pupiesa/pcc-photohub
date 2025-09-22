// app/api/pay/route.ts
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-08-27.basil", // ✅ use a stable version (or omit to use account default)
});

export async function POST(req: Request) {
  try {
    const { promoCode, userNumber, orderAmount } = await req.json();

    if (!promoCode || !userNumber || !orderAmount) {
      return new Response(
        JSON.stringify({ ok: false, message: "Missing fields" }),
        { status: 400 }
      );
    }

    // 1) Validate promo on your backend
    const base = process.env.MONGO_BASE_SERVER!.replace(/\/$/, "");
    const validateRes = await fetch(
      `${base}/api/promos/${encodeURIComponent(promoCode)}/validate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userNumber, orderAmount }),
        cache: "no-store",
      }
    );

    if (!validateRes.ok) {
      const msg = await validateRes.text();
      return new Response(JSON.stringify({ ok: false, message: msg }), {
        status: 400,
      });
    }
    const { data: promo } = await validateRes.json(); // expect { ok:true, data:{...} }

    // 2) Compute discounted amount (satang)
    const toSatang = (amt: number) => Math.round(amt * 100);
    const originalSatang = toSatang(orderAmount);
    let finalSatang = originalSatang;

    if (promo?.type === "percent") {
      finalSatang = Math.max(
        0,
        Math.round(originalSatang * (1 - (promo.value || 0) / 100))
      );
    } else if (promo?.type === "amount") {
      finalSatang = Math.max(0, originalSatang - toSatang(promo.value || 0));
    }

    if (finalSatang <= 0) {
      return new Response(
        JSON.stringify({ ok: false, message: "Invalid final amount" }),
        { status: 400 }
      );
    }

    // 3) Create + CONFIRM PromptPay PI to get QR in next_action
    const paymentIntent = await stripe.paymentIntents.create({
      amount: finalSatang,
      currency: process.env.CURRENCY || "thb",
      payment_method_types: ["promptpay"],
      payment_method_data: { type: "promptpay" }, // ✅
      confirm: true, // ✅ confirm now to receive next_action
      metadata: {
        promo_code: String(promoCode),
        user_number: String(userNumber),
        original_amount: String(originalSatang),
        final_amount: String(finalSatang),
      },
    });

    // 4) Extract QR
    const qr =
      (paymentIntent.next_action as any)?.promptpay_display_qr_code
        ?.image_url_png ?? null;

    return new Response(
      JSON.stringify({
        ok: true,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
        qr, // ← show this image below your PromotionCard
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        message: e?.message || "PAY_CREATE_FAILED",
      }),
      { status: 500 }
    );
  }
}
