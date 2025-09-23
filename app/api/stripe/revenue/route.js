import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

// GET /api/stripe/revenue?days=30
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const days = Math.min(Number(searchParams.get("days") ?? 30), 365);

    const now = Math.floor(Date.now() / 1000);
    const since = now - days * 24 * 60 * 60;

    const pageSize = 100;
    let hasMore = true;
    let startingAfter = undefined;

    const buckets = new Map();

    while (hasMore) {
      const res = await stripe.paymentIntents.list({
        limit: pageSize,
        created: { gte: since, lte: now },
        starting_after: startingAfter,
      });

      for (const pi of res.data) {
        // Some Stripe API versions don't allow server-side 'status' filter here — filter client-side
        if (pi.status !== "succeeded") continue;
        const d = new Date((pi.created ?? now) * 1000);
        const key = d.toISOString().slice(0, 10);
        const amount = (pi.amount_received ?? pi.amount ?? 0) / 100;
        buckets.set(key, (buckets.get(key) ?? 0) + amount);
      }

      hasMore = res.has_more;
      startingAfter = res.data.at(-1)?.id;
    }

    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      out.push({
        date: key,
        amount: Number((buckets.get(key) ?? 0).toFixed(2)),
      });
    }

    return NextResponse.json({ currency: "AUTO", series: out });
  } catch (err) {
    console.error("/api/stripe/revenue error", err);
    return NextResponse.json(
      { error: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
