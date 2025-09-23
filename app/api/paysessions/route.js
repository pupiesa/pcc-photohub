import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "photobooth";

async function connect() {
  if (!MONGO_URI) throw new Error("MONGODB_URI not configured");
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  return client;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const days = Math.min(Number(searchParams.get("days") ?? 30), 365);
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

    const client = await connect();
    const db = client.db(DB_NAME);
    const col = db.collection("paysessions");

    // recent sessions
    const recent = await col
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    // aggregate revenue by day for the last `days`
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          total: { $sum: "$finalAmountTHB" },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const agg = await col.aggregate(pipeline).toArray();

    // build full series with zeros for missing days
    const map = new Map();
    for (const row of agg) map.set(row._id, Number(row.total || 0));

    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      series.push({ date: key, amount: Number((map.get(key) ?? 0).toFixed(2)) });
    }

    // map recent sessions to payments format
    const items = recent.map((doc) => ({
      id: doc.paymentIntentId || doc._id?.toString(),
      amount: doc.finalAmountTHB || 0,
      currency: "THB",
      status: doc.status || "unknown",
      created: new Date(doc.createdAt).getTime(),
      customer: doc.userNumber || null,
    }));

    await client.close();

    return NextResponse.json({ items, series });
  } catch (err) {
    console.error("/api/paysessions error", err?.message || err);
    return NextResponse.json({ error: err?.message ?? "Unexpected error" }, { status: 500 });
  }
}
