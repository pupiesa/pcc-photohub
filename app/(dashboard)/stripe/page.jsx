"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TrendingUp, RefreshCw } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function StripeDashboardPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [revenue, setRevenue] = useState([]);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      // Prefer application DB paysessions endpoint
      const resDb = await fetch(`/api/paysessions?days=${days}&limit=50`);
      if (resDb.ok) {
        const j = await resDb.json();
        setPayments(j.items || []);
        setRevenue(j.series || []);
        return;
      }

      // If DB route not available, fall back to Stripe API endpoints
      const [resP, resR] = await Promise.all([
        fetch(`/api/stripe/payments?limit=50`),
        fetch(`/api/stripe/revenue?days=${days}`),
      ]);

      const p = resP.ok ? await resP.json() : { error: await resP.text() };
      const r = resR.ok ? await resR.json() : { error: await resR.text() };

      if (p.error) console.error("/api/stripe/payments error:", p.error);
      if (r.error) console.error("/api/stripe/revenue error:", r.error);

      if (!r.error && (!r.series || r.series.length === 0)) {
        console.warn("/api/stripe/revenue returned empty series:", r);
      }

      setPayments((p && p.items) || []);
      setRevenue((r && r.series) || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [days]);

  const totalThisPeriod = useMemo(
    () => revenue.reduce((s, x) => s + (x.amount ?? 0), 0),
    [revenue]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        (p.customer ?? "").toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q)
    );
  }, [payments, search]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Stripe Dashboard</h1>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search payments..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <select
            className="border rounded-md h-10 px-2"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Total Revenue ({days}d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {totalThisPeriod.toLocaleString()} Bath
            </div>
            {totalThisPeriod === 0 && (
              <div className="text-xs text-rose-600 mt-2">
                No revenue found for this period — ensure your Stripe test/live
                key is set and that there are succeeded PaymentIntents.
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Gross via succeeded PaymentIntents
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Payments (last 50)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{payments.length}</div>
            <p className="text-xs text-muted-foreground">
              Recent PaymentIntents
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Trend</CardTitle>
            <TrendingUp className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              Daily revenue over time
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue (daily)</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={revenue}
              margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
            >
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(v) =>
                  v && v.toLocaleString ? v.toLocaleString() : v
                }
              />
              <Line
                type="monotone"
                dataKey="amount"
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest Payments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.id}</TableCell>
                    <TableCell className="text-xs">
                      {p.customer ?? "-"}
                    </TableCell>
                    <TableCell className="text-xs capitalize">
                      {p.status}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.amount.toLocaleString()} {p.currency}
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(p.created).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
