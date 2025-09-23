import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

// GET /api/stripe/payments?limit=20
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);

    const list = await stripe.paymentIntents.list({
      limit,
      expand: ["data.latest_charge"],
    });

    const items = list.data.map((pi) => ({
      id: pi.id,
      amount: (pi.amount_received ?? pi.amount ?? 0) / 100,
      currency: (pi.currency ?? "usd").toUpperCase(),
      status: pi.status,
      created: (pi.created ?? 0) * 1000,
      customer:
        typeof pi.customer === "string" ? pi.customer : pi.customer?.id ?? null,
      latest_charge_id:
        typeof pi.latest_charge === "string"
          ? pi.latest_charge
          : pi.latest_charge?.id ?? null,
      payment_method:
        typeof pi.payment_method === "string"
          ? pi.payment_method
          : pi.payment_method?.id ?? null,
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error("/api/stripe/payments error", err);
    return NextResponse.json(
      { error: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
