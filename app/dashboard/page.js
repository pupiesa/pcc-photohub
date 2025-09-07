"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import QRCode from "react-qr-code";
import { client } from "@/lib/photoboothClient";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const NC_BASE = process.env.NEXT_PUBLIC_NC_BASE || "/ncapi"; // rewrite ไป nextcloud-api

const buildProxyPreview = (relPath) =>
  `${(NC_BASE || "").replace(/\/$/, "")}/api/nextcloud/preview?path=${encodeURIComponent(
    relPath
  )}`;

function deriveRelPath(it) {
  if (it?.path) return String(it.path).replace(/^\/+/, "");

  try {
    if (it?.previewUrl) {
      const u = new URL(it.previewUrl);
      const f = u.searchParams.get("file");
      if (f) return decodeURIComponent(f).replace(/^\/+/, "");
    }
  } catch {}

  try {
    if (it?.downloadUrl) {
      const u = new URL(it.downloadUrl);
      const p = u.searchParams.get("path");
      const files = u.searchParams.get("files"); 
      if (files) {
        const dir = p ? decodeURIComponent(p).replace(/^\/+/, "") : "";
        return dir ? `${dir}/${files}` : files;
      }
    }
  } catch {}

  return String(it?.name || "").replace(/^\/+/, "");
}

function ProxyPreview({ item }) {
  const rel = deriveRelPath(item);
  if (!rel) return <div className="w-full h-32 bg-gray-200/20 rounded" />;

  return (
    <div className="relative w-full h-32">
      <Image
        src={buildProxyPreview(rel)}
        alt="preview"
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
        className="object-cover select-none pointer-events-none"
        unoptimized
      />
    </div>
  );
}

export default function CustomerDashboard() {
  const router = useRouter();
  const [phone, setPhone] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ count: 0, link: null });
  const [error, setError] = useState(null);

  useEffect(() => {
    const p =
      typeof window !== "undefined"
        ? localStorage.getItem("pcc_user_phone")
        : null;
    if (!p) {
      router.replace("/booth");
      return;
    }
    setPhone(p);
  }, [router]);

  const load = async (p) => {
    setLoading(true);
    setError(null);
    try {
      const u = await client.getUserByNumber(p);
      const link = u?.data?.nextcloud_link ?? null;
      const count =
        u?.file_summary?.count ??
        (Array.isArray(u?.data?.file_address) ? u.data.file_address.length : 0);
      setSummary({ count, link });

      const g = await client.getUserGallery(p);
      const onlyImages = (g?.files || []).filter((it) =>
        IMAGE_RE.test(it?.name || "")
      );
      setGallery(onlyImages);
    } catch (e) {
      console.error("dashboard load error:", e);
      setError("Failed to load your gallery. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (phone) load(phone);
  }, [phone]);

  const refresh = () => phone && load(phone);
  const logout = () => {
    localStorage.removeItem("pcc_user_phone");
    router.push("/booth");
  };
  const goBack = () => router.push("/booth");

  return (
    <div className="min-h-screen w-full flex flex-col items-center py-8">
      <div className="w-full max-w-5xl px-4 flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold tracking-tight">My Gallery</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={goBack}>
            Back
          </Button>
          <Button variant="outline" onClick={refresh}>
            Refresh
          </Button>
          <Button onClick={logout}>Logout</Button>
        </div>
      </div>

      <div className="w-full max-w-5xl px-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* PHOTOS */}
        <Card className="md:col-span-2 order-2 md:order-1">
          <CardHeader>
            <CardTitle>Photos</CardTitle>
            <CardDescription>
              {phone ? `Phone: ${phone}` : "Loading…"}
              {summary.count ? ` • Total: ${summary.count}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-gray-500">Loading gallery…</div>
            ) : error ? (
              <div className="text-sm text-red-600">{error}</div>
            ) : gallery.length === 0 ? (
              <div className="text-sm text-gray-500">No photos yet.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {gallery.map((it, idx) => (
                  <div
                    key={`${(it.name || it.path || "item")}-${idx}`}
                    className="group rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700"
                    title={it.name}
                  >
                    <ProxyPreview item={it} />
                    <div className="px-2 py-1 text-xs truncate text-gray-600 dark:text-gray-300">
                      {it.name}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="order-1 md:order-2">
          <CardHeader>
            <CardTitle>Customer Summary</CardTitle>
            <CardDescription>Overview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              <div className="text-gray-500 dark:text-gray-400">Phone</div>
              <div className="font-medium">{phone || "-"}</div>
            </div>
            <div className="text-sm">
              <div className="text-gray-500 dark:text-gray-400">Total Photos</div>
              <div className="font-medium">{summary.count}</div>
            </div>

            <div className="text-sm">
              <div className="text-gray-500 dark:text-gray-400 mb-2">
                Shared Link (QR)
              </div>
              {summary.link ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="bg-white p-2 rounded-md">
                    <QRCode value={summary.link} size={160} />
                  </div>
                </div>
              ) : (
                <div className="font-medium">Not created yet</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
