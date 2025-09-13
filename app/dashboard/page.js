"use client";

import { useEffect, useState, useMemo, useRef } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BackgroundGradient } from "@/components/ui/shadcn-io/background-gradient";

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const NC_BASE = process.env.NEXT_PUBLIC_NC_BASE || "/ncapi"; // rewrite ไป nextcloud-api

const buildProxyPreview = (relPath) =>
  `${(NC_BASE || "").replace(/\/$/, "")}/api/nextcloud/preview?path=${encodeURIComponent(
    relPath
  )}`;

function deriveRelPath(it) {
  if (it && it.path) return String(it.path).replace(/^\/+/, "");

  try {
    if (it && it.previewUrl) {
      const u = new URL(it.previewUrl);
      const f = u.searchParams.get("file");
      if (f) return decodeURIComponent(f).replace(/^\/+/, "");
    }
  } catch {}

  try {
    if (it && it.downloadUrl) {
      const u = new URL(it.downloadUrl);
      const p = u.searchParams.get("path");
      const files = u.searchParams.get("files");
      if (files) {
        const dir = p ? decodeURIComponent(p).replace(/^\/+/, "") : "";
        return dir ? `${dir}/${files}` : files;
      }
    }
  } catch {}

  return String((it && it.name) || "").replace(/^\/+/, "");
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

  // --- Dialog state for Gmail + OTP ---
  const [openEmailFlow, setOpenEmailFlow] = useState(false);
  const [step, setStep] = useState("email"); // "email" | "otp"
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [flowError, setFlowError] = useState(null);
  const otpInputRef = useRef(null);

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
      const link = (u && u.data && u.data.nextcloud_link) || null;
      const count =
        (u && u.file_summary && u.file_summary.count) != null
          ? u.file_summary.count
          : Array.isArray(u && u.data && u.data.file_address)
          ? u.data.file_address.length
          : 0;
      setSummary({ count, link });

      const g = await client.getUserGallery(p);
      const onlyImages = ((g && g.files) || []).filter((it) =>
        IMAGE_RE.test((it && it.name) || "")
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

  const emailValid = useMemo(() => {
    const v = email.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
  }, [email]);

  const otpValid = useMemo(() => /^\d{6}$/.test(otp.trim()), [otp]);

  const handleOpenEmailFlow = () => {
    setFlowError(null);
    setEmail("");
    setConsent(false);
    setOtp("");
    setStep("email");
    setOpenEmailFlow(true);
  };

  const handleSendOtp = async () => {
    setFlowError(null);
    setSending(true);
    try {
      // TODO: เรียก backend จริงของคุณ เช่น:
      // await client.sendOtp({ phone, email })
      await new Promise((r) => setTimeout(r, 500)); // mock
      setStep("otp");
      setTimeout(() => {
        if (otpInputRef.current) otpInputRef.current.focus();
      }, 50);
    } catch (e) {
      setFlowError((e && e.message) || "ส่งรหัสไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    setFlowError(null);
    setSending(true);
    try {
      // TODO: verify OTP จริง:
      // const { link } = await client.verifyOtp({ phone, email, otp })
      await new Promise((r) => setTimeout(r, 500)); // mock

      const finalLink =
        summary.link ||
        `https://example.com/share/${encodeURIComponent(String(phone))}`;

      setSummary((s) => ({ ...s, link: finalLink }));
      setOpenEmailFlow(false);
    } catch (e) {
      setFlowError((e && e.message) || "ยืนยันรหัสไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSending(false);
    }
  };

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
                  <BackgroundGradient className="rounded-xl p-3">
                    <div className="bg-white p-3 rounded-lg">
                      <div className="text-xs font-semibold text-gray-800 text-center mb-2">
                        ProjectPhoto_PCC
                      </div>
                      <QRCode value={summary.link} size={172} />
                    </div>
                  </BackgroundGradient>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="font-medium">ยังไม่ได้สร้างลิงก์</div>
                  <Button onClick={handleOpenEmailFlow}>ใส่ Gmail</Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Email + OTP Flow */}
      <Dialog open={openEmailFlow} onOpenChange={setOpenEmailFlow}>
        <DialogContent className="sm:max-w-lg">
          {step === "email" ? (
            <>
              <DialogHeader>
                <DialogTitle>ยืนยันอีเมล</DialogTitle>
                <DialogDescription>
                  กรอกอีเมลเพื่อรับรหัส OTP 6 หลัก
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">อีเมล</Label>
                  <Input
                    id="email"
                    type="email"
                    inputMode="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  {!emailValid && email.length > 0 && (
                    <p className="text-xs text-red-600">
                      รูปแบบอีเมลไม่ถูกต้อง
                    </p>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label>เงื่อนไขการใช้งาน</Label>
                  <ScrollArea className="h-40 rounded-md border p-3 text-sm leading-6">
                    <p>
                      • ระบบจะส่งรหัส OTP ไปยังอีเมลของคุณเพื่อยืนยันตัวตน
                      การใช้งานนี้ถือว่าคุณยินยอมให้เราประมวลผลอีเมลเพื่อการส่งรหัส
                      และเชื่อมโยงกับเบอร์โทรศัพท์ที่ใช้เข้าสู่ระบบ…
                    </p>
                    <p className="mt-2">
                      • ลิงก์แชร์รูปภาพจะถูกสร้างจากบัญชี Nextcloud
                      และอาจมีวันหมดอายุหรือสิทธิ์การเข้าถึงตามที่ผู้ดูแลกำหนด…
                    </p>
                    <p className="mt-2">
                      • โปรดเก็บรักษารหัส OTP และลิงก์แชร์เป็นความลับ
                      เพื่อความปลอดภัยของข้อมูลของคุณ…
                    </p>
                    <p className="mt-2">
                      • รายละเอียดฉบับเต็มโปรดดูนโยบายความเป็นส่วนตัวของเรา…
                    </p>
                  </ScrollArea>

                  <div className="flex items-start gap-2 pt-2">
                    <Checkbox
                      id="consent"
                      checked={consent}
                      onCheckedChange={(v) => setConsent(Boolean(v))}
                    />
                    <Label htmlFor="consent" className="text-sm leading-6">
                      ฉันได้อ่านและยินยอมตามเงื่อนไขการใช้งาน
                    </Label>
                  </div>
                </div>

                {flowError && (
                  <div className="text-sm text-red-600">{flowError}</div>
                )}
              </div>

              <DialogFooter className="mt-2">
                <Button
                  variant="outline"
                  onClick={() => setOpenEmailFlow(false)}
                >
                  ยกเลิก
                </Button>
                <Button
                  onClick={handleSendOtp}
                  disabled={!emailValid || !consent || sending}
                >
                  {sending ? "กำลังส่ง…" : "ถัดไป"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>ใส่รหัส OTP</DialogTitle>
                <DialogDescription>
                  เราส่งรหัส 6 หลักไปที่ <span className="font-medium">{email}</span>
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="otp">รหัส OTP 6 หลัก</Label>
                  <Input
                    id="otp"
                    ref={otpInputRef}
                    inputMode="numeric"
                    pattern="\\d{6}"
                    maxLength={6}
                    placeholder="______"
                    value={otp}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setOtp(v);
                    }}
                    className="tracking-widest text-center text-lg"
                  />
                  {!otpValid && otp.length > 0 && (
                    <p className="text-xs text-red-600">ต้องเป็นตัวเลข 6 หลัก</p>
                  )}
                </div>

                {flowError && (
                  <div className="text-sm text-red-600">{flowError}</div>
                )}
              </div>

              <DialogFooter className="mt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep("email");
                    setOtp("");
                    setFlowError(null);
                  }}
                >
                  กลับ
                </Button>
                <Button onClick={handleVerifyOtp} disabled={!otpValid || sending}>
                  {sending ? "กำลังยืนยัน…" : "ยืนยันรหัส"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
