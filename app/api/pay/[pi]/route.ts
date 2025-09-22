// app/api/pay/[pi]/route.ts
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-08-27.basil",
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pi: string }> }
) {
  try {
    const { pi } = await ctx.params; // ← await the params
    const intent = await stripe.paymentIntents.retrieve(pi);
    return new Response(JSON.stringify({ ok: true, status: intent.status }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, message: e.message || "PAY_STATUS_FAILED" }),
      { status: 500 }
    );
  }
}
