import Stripe from "stripe";
import { NextRequest } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-08-27.basil",
});

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  const buf = Buffer.from(await req.arrayBuffer());

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig!, webhookSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        console.log("✅ Payment succeeded:", pi.id);

        // Read metadata we added when creating PI
        const promoCode = String(pi.metadata?.promo_code || "");
        const userNumber = String(pi.metadata?.user_number || "");
        const orderAmount =
          Number(pi.metadata?.final_amount || pi.amount) / 100; // in THB

        if (promoCode && userNumber) {
          // Redeem promo in your backend
          const base = process.env.MONGO_BASE_SERVER!.replace(/\/$/, "");
          await fetch(
            `${base}/api/promos/${encodeURIComponent(promoCode)}/redeem`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userNumber, orderAmount }),
            }
          );
          console.log(`🎟 Promo ${promoCode} redeemed for user ${userNumber}`);
        }

        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        console.warn("❌ Payment failed:", pi.id);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err: any) {
    console.error("Webhook handling failed:", err.message);
  }

  return new Response("ok", { status: 200 });
}

export const config = {
  api: {
    bodyParser: false, // ensure raw body
  },
};
