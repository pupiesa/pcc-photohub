// app/dashboard/page.js
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { client } from "@/lib/photoboothClient";
import { Loader } from "@/components/ui/shadcn-io/ai/loader";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { BackgroundGradient } from "@/components/ui/shadcn-io/background-gradient";
import { Skeleton } from "@/components/ui/skeleton";
import { GradientText } from "@/components/ui/shadcn-io/gradient-text";

/* ---------- helpers ---------- */
const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const NC_BASE = process.env.NEXT_PUBLIC_NC_BASE || "/ncapi";
const OTP_TOTAL_SECS = 80;
const INACTIVITY_MS = 120_000; // 2 นาที

const buildProxyPreview = (relPath) =>
  `${(NC_BASE || "").replace(/\/$/, "")}/api/nextcloud/preview?path=${encodeURIComponent(relPath)}`;

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

function ProxyPreview({ item, onLoadingComplete, className }) {
  const rel = deriveRelPath(item);
  if (!rel) return <div className="w-full aspect-square bg-gray-200/20 rounded" />;
  return (
    <div className={`relative w-full aspect-square ${className || ""}`}>
      <Image
        src={buildProxyPreview(rel)}
        alt={item?.name || "preview"}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
        className="object-cover select-none"
        unoptimized
        loading="lazy"
        onLoadingComplete={onLoadingComplete}
      />
    </div>
  );
}

/* ---------- Progressive Gallery  ---------- */
function PhotoCard({ item }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      className="group relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700"
      title={item?.name}
    >
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          loaded ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="w-full h-full">
          <div className="w-full h-full bg-gray-300/10 dark:bg-gray-700/30" />
        </div>
      </div>

      <ProxyPreview
        item={item}
        className={`transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoadingComplete={() => setLoaded(true)}
      />
    </div>
  );
}

/* ---------- Grid + Infinite Scroll  ---------- */
const PAGE_SIZE = 9;

function useInfiniteInScrollArea({ rootRef, hasMore, loadMore, margin = "1000px" }) {
  const sentinelRef = useRef(null);
  useEffect(() => {
    if (!rootRef.current || !sentinelRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting && hasMore) loadMore();
      },
      { root: rootRef.current, rootMargin: margin, threshold: 0.01 }
    );
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [rootRef, hasMore, loadMore, margin]);
  return { sentinelRef };
}

function GalleryScrollGrid({ gallery }) {
  const scrollRef = useRef(null);
  const [page, setPage] = useState(1);
  const visible = useMemo(() => gallery.slice(0, page * PAGE_SIZE), [gallery, page]);
  const hasMore = visible.length < gallery.length;
  const loadMore = useCallback(() => setPage((p) => p + 1), []);

  const { sentinelRef } = useInfiniteInScrollArea({
    rootRef: scrollRef,
    hasMore,
    loadMore,
    margin: "1000px",
  });

  return (
    <ScrollArea ref={scrollRef} className="h-[46vh] pr-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {visible.map((it, idx) => (
          <PhotoCard
            key={`${it.name || it.path || "item"}-${idx}`}
            item={it}
            priority={idx < 8} // รูปชุดแรก ๆ โหลดแบบ eager
          />
        ))}

        {hasMore &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={`sk-${i}`} className="rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="w-full aspect-square bg-gray-300/10 dark:bg-gray-700/30 animate-pulse" />
            </div>
          ))}
      </div>
      <div ref={sentinelRef} className="h-4 w-full" />
    </ScrollArea>
  );
}

/* ---------- Inline Keyboards ---------- */
function InlineOtpKeypad({ visible, setValue, onDone }) {
  if (!visible) return null;
  const keys = ["1","2","3","4","5","6","7","8","9","0"];
  const press = (k) => {
    if (k === "back") setValue((v) => v.slice(0, -1));
    else if (k === "clear") setValue("");
    else if (k === "paste") {
      navigator.clipboard.readText().then((t) => {
        setValue(String(t).replace(/\D/g, "").slice(0, 6));
      }).catch(() => {});
    } else setValue((v) => (v + k).replace(/\D/g, "").slice(0, 6));
  };
  return (
    <div className="mt-3 rounded-xl border p-3 bg-muted/30">
      <div className="grid grid-cols-3 gap-2">
        {keys.slice(0, 9).map((k) => (
          <Button key={k} variant="secondary" onClick={() => press(k)}>{k}</Button>
        ))}
        <Button variant="outline" onClick={() => press("clear")} className="bg-red-500 text-white hover:bg-red-700">ล้าง</Button>
        <Button variant="secondary" onClick={() => press("0")}>0</Button>
        <Button variant="outline" onClick={() => press("back")}>⌫</Button>
      </div>
      <div className="flex gap-2 pt-2 justify-end">
        <Button onClick={onDone}>เสร็จสิ้น</Button>
      </div>
    </div>
  );
}

function InlineEmailKeyboard({ visible, setValue, onDone }) {
  if (!visible) return null;
  const rows = [
    ["1","2","3","4","5","6","7","8","9","0"],
    ["q","w","e","r","t","y","u","i","o","p"],
    ["a","s","d","f","g","h","j","k","l","@"],
    ["z","x","c","v","b","n","m",".","_","-"],
  ];
  const press = (k) => {
    if (k === "back") setValue((v) => v.slice(0, -1));
    else if (k === "clear") setValue("");
    else if (k === "paste") {
      navigator.clipboard.readText().then((t) => setValue(String(t))).catch(()=>{});
    } else setValue((v) => (v + k).slice(0, 254));
  };
  return (
    <div className="mt-3 rounded-xl border p-3 bg-muted/30">
      <div className="space-y-2">
         <div className="flex gap-1  rounded-xl justify-start">
          <Button variant="secondary" onClick={() => press("@gmail.com")} className="bg-linear-65 from-purple-500 to-pink-500 text-white hover:opacity-80">@gmail.com</Button>
          <Button variant="secondary" onClick={() => press("@kmitl.ac.th")} className="bg-linear-65 from-purple-500 to-pink-500 text-white hover:opacity-80">@kmitl.ac.th</Button>
          <Button variant="secondary" onClick={() => press("@@outlook.com")} className="bg-linear-65 from-purple-500 to-pink-500 text-white hover:opacity-80">@outlook.com</Button>
        </div>
        {rows.map((row, idx) => (
          <div key={idx} className="flex gap-1 justify-center">
            {row.map((k) => (
              <Button key={k} variant="secondary" className="min-w-9" onClick={() => press(k)}>
                {k}
              </Button>
            ))}
          </div>
        ))}
        <div className="flex gap-1 justify-end">
          <Button variant="outline" onClick={() => press("clear")} className="bg-linear-65 from-red-700 to-red-700 text-white hover:opacity-80">ล้าง</Button>
          <Button variant="outline" onClick={() => press("back")}>⌫</Button>
        </div>
        <div className="flex justify-end">
          <Button onClick={onDone}>เสร็จสิ้น</Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Page ---------- */
export default function CustomerDashboard() {
  const router = useRouter();

  const [phone, setPhone] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [summary, setSummary] = useState({ count: 0, link: null, hasEmail: false, displayName: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // dialog steps: email -> terms -> otp
  const [openEmailFlow, setOpenEmailFlow] = useState(false);
  const [step, setStep] = useState/** @type {"email"|"terms"|"otp"} */("email");

  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [flowError, setFlowError] = useState(null);

  // otp
  const [otp, setOtp] = useState("");
  const [otpSecsLeft, setOtpSecsLeft] = useState(OTP_TOTAL_SECS);
  const [canResend, setCanResend] = useState(false);
  const [otpTimerKey, setOtpTimerKey] = useState(0);
  const isUrgent = otpSecsLeft > 0 && otpSecsLeft <= 25; //progress bar  25 sec blink red color

  // soft keyboards
  const [showEmailKb, setShowEmailKb] = useState(false);
  const [showOtpKb, setShowOtpKb] = useState(false);
  const emailKbSuppressRef = useRef(false);

  const emailInputRef = useRef(null);
  const otpFirstSlotRef = useRef(null);

  const safeSelectAll = (el) => {
    try { if (el?.setSelectionRange) el.setSelectionRange(0, el.value?.length ?? 0); } catch {}
  };

  useEffect(() => {
    const p = typeof window !== "undefined" ? localStorage.getItem("pcc_user_phone") : null;
    if (!p) { router.replace("/booth"); return; }
    setPhone(p);
  }, [router]);

  const load = async (p) => {
    setLoading(true); setError(null);
    try {
      const u = await client.getUserByNumber(p);
      const data = u?.data || {};
      const link = data.nextcloud_link || null;
      const hasEmail = Boolean(data.gmail) || Boolean(data.hasEmail);
      const displayName = data.name || null;
      const count = u?.file_summary?.count != null
        ? u.file_summary.count
        : (Array.isArray(data.file_address) ? data.file_address.length : 0);
      setSummary({ count, link, hasEmail, displayName });

      const g = await client.getUserGallery(p);
      const onlyImages = (g?.files || []).filter((it) => IMAGE_RE.test(String(it?.name || "")));
      setGallery(onlyImages);
    } catch (e) {
      console.error("dashboard load error:", e);
      setError(e?.message || "Failed to load your gallery. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (phone) load(phone); }, [phone]);
  const refresh = () => phone && load(phone);

  /* ---------- Auto logout + visible countdown ---------- */
  const logout = useCallback(() => {
    localStorage.removeItem("pcc_user_phone");
    localStorage.removeItem("pcc_user_pin");
    router.push("/booth");
  }, [router]);

  const deadlineRef = useRef(0);
  const [secondsLeft, setSecondsLeft] = useState(null);

  const resetIdle = useCallback(() => {
    deadlineRef.current = Date.now() + INACTIVITY_MS;
    setSecondsLeft(Math.ceil(INACTIVITY_MS / 1000));
  }, []);

  useEffect(() => {
    if (!phone) return;

    const events = ["pointerdown","keydown","mousemove","wheel","touchstart","scroll"];
    const handler = () => resetIdle();

    events.forEach((ev) => window.addEventListener(ev, handler, { passive: true }));
    resetIdle();

    const tick = setInterval(() => {
      const ms = Math.max(0, deadlineRef.current - Date.now());
      const s = Math.max(0, Math.ceil(ms / 1000));
      setSecondsLeft(s);
      if (s <= 0) {
        clearInterval(tick);
        events.forEach((ev) => window.removeEventListener(ev, handler));
        logout();
      }
    }, 1000);

    return () => {
      clearInterval(tick);
      events.forEach((ev) => window.removeEventListener(ev, handler));
    };
  }, [phone, logout, resetIdle]);

  const goBack = () => router.push("/booth");

  const emailValid = useMemo(() => {
    const v = email.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
  }, [email]);

  // focus + keyboards according to step
  useEffect(() => {
    if (!openEmailFlow) return;
    const t = setTimeout(() => {
      if (step === "email" && emailInputRef.current) {
        safeSelectAll(emailInputRef.current);
        emailInputRef.current.scrollIntoView({ block: "center" });
        setShowEmailKb(true);
      }
      if (step === "otp" && otpFirstSlotRef.current) {
        setShowOtpKb(true);
      }
      if (step === "terms") {
        setShowEmailKb(false);
        setShowOtpKb(false);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [openEmailFlow, step, email.length]);

  // otp countdown
  useEffect(() => {
    if (step !== "otp") return;
    setOtpSecsLeft(OTP_TOTAL_SECS);
    setCanResend(false);
    let alive = true;
    const id = setInterval(() => {
      if (!alive) return;
      setOtpSecsLeft((s) => {
        if (s <= 1) { clearInterval(id); setCanResend(true); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [step, otpTimerKey]);

  const isDuplicateEmailError = (e) => {
    const msg = String(e?.message || "").toLowerCase();
    const code = String(e?.payload?.code || "").toLowerCase();
    return (
      e?.status === 409 ||
      msg.includes("duplicate") || msg.includes("already") ||
      msg.includes("exists") || msg.includes("in use") ||
      code.includes("duplicate") || code.includes("email_exists") || code.includes("email_in_use")
    );
  };

  const handleGoTerms = () => {
    if (!emailValid) return;
    setFlowError(null);
    setShowEmailKb(false);
    setStep("terms");
  };

  const handleSendOtp = async () => {
    if (!phone) return;
    setFlowError(null); setSending(true);
    try {
      await client.requestEmailOTP({ number: phone, email: email.trim(), heading: 'Verify your email' });
      setStep("otp");
      setOtpTimerKey((k) => k + 1);
      toast.success("ส่งรหัส OTP แล้ว ตรวจอีเมลของคุณ");
      setShowOtpKb(true);
      setShowEmailKb(false);
    } catch (e) {
      console.error(e);
      if (isDuplicateEmailError(e)) {
        toast.error("อีเมลนี้ถูกใช้แล้ว โปรดใช้อีเมลอื่น", { duration: 5000 });
        setStep("email");
        setTimeout(() => emailInputRef.current?.focus({ preventScroll: true }), 30);
        return;
      }
      setFlowError(e?.message || "ส่งรหัสไม่สำเร็จ กรุณาลองใหม่");
      toast.error(e?.message || "ส่งรหัสไม่สำเร็จ");
    } finally { setSending(false); }
  };

  const createNextcloudLink = async (passwordOverride) => {
    if (!phone) return null;
    const linkPassword = (passwordOverride || summary.displayName?.trim() || String(phone)).replace(/\s+/g, "");
    const res = await client.shareOnly({
      folderName: phone, permissions: 1, publicUpload: false,
      note: `Share for ${phone}`, linkPassword, expiration: null, forceNew: true,
    });
    const link = res?.share?.url || res?.url || res?.data?.url || res?.publicUrl || res?.link || null;
    if (!link) throw new Error("สร้างลิงก์สำเร็จ แต่ไม่พบ URL สำหรับใช้งาน");
    await client.setNextcloudLink(phone, link);
    return link;
  };

  const handleResend = async () => {
    if (!phone || !canResend) return;
    setFlowError(null); setSending(true);
    try {
      await client.requestEmailOTP({ number: phone, email: email.trim(), heading: 'Verify your email' });
      setOtp(""); setOtpTimerKey((k) => k + 1);
      setTimeout(() => otpFirstSlotRef.current?.focus({ preventScroll: true }), 30);
      toast.success("ส่งรหัสใหม่แล้ว");
      setShowOtpKb(true);
    } catch (e) {
      setFlowError(e?.message || "ส่งรหัสใหม่ไม่สำเร็จ");
      toast.error(e?.message || "ส่งรหัสใหม่ไม่สำเร็จ");
    } finally { setSending(false); }
  };

  const handleVerifyOtp = async () => {
    if (!phone) return;
    setFlowError(null); setSending(true);
    try {
      await client.confirmEmailOTP({ number: phone, email: email.trim(), otp: otp.trim() });
      await client.setGmail(phone, email.trim());
      await client.setConsentedTrue(phone);

      const newPassword = (summary.displayName?.trim() || String(phone)).replace(/\s+/g, "");

      if (summary.link) {
        await client.changeSharePasswordForUser({
          number: phone,
          newPassword,
          permissions: 1,
          publicUpload: false,
          note: `Protect share for ${phone}`,
        });
      } else {
        await createNextcloudLink(newPassword);
      }

      await load(phone);
      setOpenEmailFlow(false);
      toast.success("ยืนยันอีเมลสำเร็จ");
    } catch (e) {
      console.error(e);
      if (isDuplicateEmailError(e)) {
        toast.error("อีเมลนี้ถูกใช้แล้ว โปรดใช้อีเมลอื่น", { duration: 5000 });
        setTimeout(() => {
          setStep("email"); setOtp("");
          setTimeout(() => emailInputRef.current?.focus({ preventScroll: true }), 30);
          setShowEmailKb(true); setShowOtpKb(false);
        }, 500);
        return;
      }
      setFlowError(e?.message || "ยืนยันรหัสไม่สำเร็จ กรุณาลองใหม่");
      toast.error(e?.message || "ยืนยันรหัสไม่สำเร็จ");
    } finally { setSending(false); }
  };

  const otpProgress = useMemo(() => {
    const p = Math.max(0, Math.min(100, (otpSecsLeft / OTP_TOTAL_SECS) * 100));
    return p;
  }, [otpSecsLeft]);

  return (
    <div className="h-full w-full overflow-hidden flex flex-col items-center py-8">
      <div className="w-full max-w-5xl px-4 flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold tracking-tight">My Gallery</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={goBack}>Back</Button>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            {loading ? (<><Loader size={16} className="mr-2" />Loading…</>) : ("Refresh")}
          </Button>
          <Button onClick={logout}>Logout</Button>
        </div>
      </div>

      <div className="w-full max-w-5xl px-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* PHOTOS (scrollable) */}
        <Card className="md:col-span-2 order-2 md:order-1">
          <CardHeader>
            <CardTitle>Photos</CardTitle>
            <CardDescription>
              {phone ? `Phone: ${phone}` : "Loading…"} {summary.count ? `• Total: ${summary.count}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                <div className="text-sm text-gray-500">Loading gallery…</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="w-full aspect-square rounded-lg" />
                  ))}
                </div>
              </div>
            ) : error ? (
              <div className="text-sm text-red-600">{error}</div>
            ) : gallery.length === 0 ? (
              <div className="text-sm text-gray-500">No photos</div>
            ) : (
              <GalleryScrollGrid gallery={gallery} />
            )}
          </CardContent>
        </Card>

        {/* SUMMARY + QR */}
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
              <div className="text-gray-500 dark:text-gray-400 mb-2">Shared Link (QR)</div>
              {summary.link && summary.hasEmail ? (
                <div className="flex flex-col items-center gap-3">
                  <BackgroundGradient className="rounded-xl p-3">
                    <div className="bg-white p-3 rounded-lg">
                      <div className="text-xs font-semibold text-gray-800 text-center mb-2">ProjectPhoto_PCC</div>
                      <QRCode value={summary.link} size={172} />
                      <div className="text-xs font-semibold text-red-500 text-center pt-2">Password is your Phone</div>
                    </div>
                  </BackgroundGradient>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="font-medium">ยันยันอีเมลเพื่อใช้ยืนยันตัวตนเเละกู้คืน PIN</div>
                  <Button onClick={() => {
                    setFlowError(null); setEmail(""); setConsent(false); setOtp("");
                    setStep("email"); setOpenEmailFlow(true); emailKbSuppressRef.current = false;
                  }}>ใส่/ยืนยันอีเมล</Button>
                   <GradientText
                    className="text-xs text-gray-500 mt-1"
                    text="*สามารถดูรูปออนไลน์ได้หลังจากยืนยันอีเมลสำเร็จ*"
                    neon
                    gradient="linear-gradient(90deg, #ff7e5f 0%, #2ae3e3ff 50%, #feb47b 100%)"
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 🔔 Idle countdown banner */}
      {typeof secondsLeft === "number" && secondsLeft > 0 && secondsLeft <= 20 && (
        <div className="fixed bottom-4 inset-x-0 flex justify-center pointer-events-none">
          <div className="pointer-events-auto px-4 py-2 rounded-full bg-black/70 text-red-500 text-sm shadow-lg backdrop-blur">
            ไม่มีการใช้งาน — จะออกจากระบบอัตโนมัติใน <span className="font-bold">{secondsLeft}</span>
          </div>
        </div>
      )}

      {/* Email + Terms + OTP Flow */}
      <Dialog
        open={openEmailFlow}
        onOpenChange={(open) => {
          setOpenEmailFlow(open);
          if (!open) {
            setStep("email"); setOtp(""); setFlowError(null);
            setSending(false); setCanResend(false);
            setShowEmailKb(false); setShowOtpKb(false);
            emailKbSuppressRef.current = false;
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {step === "email" && (
            <>
              <DialogHeader>
                <DialogTitle>ยืนยันอีเมล</DialogTitle>
                <DialogDescription>กรอกอีเมลเพื่อไปยังขั้น “เงื่อนไขการใช้งาน”</DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="email">อีเมล</Label>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setShowEmailKb((v) => !v)}>
                        {showEmailKb ? "ซ่อนแป้นพิมพ์" : "แสดงแป้นพิมพ์"}
                      </Button>
                    </div>
                  </div>

                  <Input
                    readOnly={showEmailKb}
                    id="email"
                    ref={emailInputRef}
                    type="text"
                    inputMode="email"
                    autoComplete="email"
                    enterKeyHint="go"
                    placeholder="your@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onCopy={(e) => e.preventDefault()}
                    onContextMenu={(e) => e.preventDefault()}
                    className="select-none focus:outline-none"
                  />
                  {!emailValid && email.length > 0 && (
                    <p className="text-xs text-red-600">รูปแบบอีเมลไม่ถูกต้อง</p>
                  )}

                  <InlineEmailKeyboard
                    visible={showEmailKb}
                    setValue={setEmail}
                    onDone={() => {
                      emailKbSuppressRef.current = true;
                      setShowEmailKb(false);
                      setTimeout(() => { emailKbSuppressRef.current = false; }, 400);
                    }}
                  />
                </div>

                {flowError && <div className="text-sm text-red-600">{flowError}</div>}
              </div>

              <DialogFooter className="mt-2">
                <Button variant="outline" onClick={() => setOpenEmailFlow(false)}>ยกเลิก</Button>
                <Button onClick={handleGoTerms} disabled={!emailValid}>ถัดไป</Button>
              </DialogFooter>
            </>
          )}

          {step === "terms" && (
            <>
              <DialogHeader>
                <DialogTitle>เงื่อนไขการใช้งาน</DialogTitle>
                <DialogDescription>โปรดอ่านและยอมรับก่อนรับรหัส OTP</DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                <div className="grid gap-2">
                  <ScrollArea className="h-44 rounded-md border p-3 text-sm leading-6">
                    <ul className="list-disc pl-5 space-y-2">
                        <li>ระบบจะส่ง <strong>รหัส OTP 6 หลัก</strong> ไปยังอีเมลที่คุณระบุ เพื่อใช้ยืนยันตัวตน</li>
                        <li>อีเมลที่ยืนยันแล้ว จะใช้สำหรับ <strong>ลิงก์รูปภาพ และการแจ้งเตือนบริการ</strong> เท่านั้น</li>
                        <li>กรุณาเก็บรักษา <strong>รหัส OTP และลิงก์แชร์</strong> ไว้เป็นความลับ เพื่อความปลอดภัยของคุณ</li>
                        <li><strong>ข้อควรระวัง:</strong> การเปิดเผยรหัสหรือลิงก์แก่บุคคลอื่น อาจทำให้ข้อมูลรั่วไหล pccphoto-hub ไม่รับผิดชอบต่อความเสียหายที่เกิดจากการเผยแพร่เอง</li>
                        <li>คุณยอมรับและอนุญาตให้ <strong>pccphoto-hub</strong> เก็บและใช้ข้อมูลที่เกี่ยวข้อง เพื่อการให้บริการและตามที่กฎหมายกำหนด</li>
                        <li>คุณมีสิทธิ์ <strong>ขอแก้ไข หรือลบข้อมูล</strong> ตามสิทธิที่กฎหมายคุ้มครอง</li>
                        <li>การดำเนินการต่อ ถือว่าคุณได้ <strong>ยอมรับเงื่อนไขและนโยบายความเป็นส่วนตัว</strong> แล้ว</li>
                    </ul>
                  </ScrollArea>

                  <div className="flex items-start gap-2 pt-2">
                    <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(Boolean(v))} />
                    <Label htmlFor="consent" className="text-sm leading-6">
                      ฉันได้อ่านและยอมรับเงื่อนไขการใช้งานและนโยบายความเป็นส่วนตัว
                    </Label>
                  </div>
                </div>

                {flowError && <div className="text-sm text-red-600">{flowError}</div>}
              </div>

              <DialogFooter className="mt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep("email");
                    setFlowError(null);
                    setTimeout(() => emailInputRef.current?.focus({ preventScroll: true }), 30);
                    setShowEmailKb(true);
                  }}
                >
                  กลับ
                </Button>
                <Button onClick={handleSendOtp} disabled={!consent || sending}>
                  {sending ? (<><Loader size={16} className="mr-2" />กำลังส่ง…</>) : ("ถัดไป")}
                </Button>
              </DialogFooter>
            </>
          )}

          {step === "otp" && (
            <>
              <DialogHeader>
                <DialogTitle>ใส่รหัส OTP</DialogTitle>
                <DialogDescription>เราส่งรหัส 6 หลักไปที่ <span className="font-medium">{email}</span></DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                <div className="space-y-1">
                  <Progress
                    value={otpProgress}
                    className={[
                      "h-2 rounded-full",
                      otpSecsLeft === 0
                        ? "[&>div]:bg-gray-400"
                        : isUrgent
                          ? "[&>div]:bg-red-500 [&>div]:animate-pulse"
                          : "[&>div]:bg-blue-600",
                    ].join(" ")}
                  />
                  <div className="text-xs text-gray-500">เวลาที่เหลือ: {otpSecsLeft}s</div>
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="otp">รหัส OTP 6 หลัก</Label>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setShowOtpKb((v) => !v)}>
                        {showOtpKb ? "ซ่อนแป้นพิมพ์" : "แสดงแป้นพิมพ์"}
                      </Button>
                    </div>
                  </div>

                  <InputOTP
                    maxLength={6}
                    value={otp}
                    onChange={(v) => setOtp(String(v).replace(/\D/g, "").slice(0, 6))}
                  >
                    <InputOTPGroup>
                      {[0,1,2,3,4,5].map((i) => (
                        <InputOTPSlot
                          key={i}
                          index={i}
                          ref={i === 0 ? otpFirstSlotRef : undefined}
                          inputMode="numeric"
                          enterKeyHint="done"
                          aria-label={`digit-${i + 1}`}
                          pattern="\d*"
                          onFocus={(e) => { e.target.scrollIntoView({ block: "center" }); setShowOtpKb(true); }}
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>

                  {!/^\d{6}$/.test(otp || "") && otp.length > 0 && <p className="text-xs text-red-600">ต้องเป็นตัวเลข 6 หลัก</p>}

                  <InlineOtpKeypad
                    visible={showOtpKb}
                    setValue={setOtp}
                    onDone={() => {
                      setShowOtpKb(false);
                      setTimeout(() => otpFirstSlotRef.current?.focus({ preventScroll: true }), 30);
                    }}
                  />

                  <div className="flex items-center gap-2 pt-1">
                    <Button type="button" variant="outline" size="sm" onClick={handleResend} disabled={!canResend || sending}>
                      {sending ? (<><Loader size={14} className="mr-2" />ส่งรหัสใหม่</>) : ("ส่งรหัสใหม่")}
                    </Button>
                    {!canResend && <span className="text-xs text-gray-500">ขอรหัสใหม่ได้เมื่อครบเวลา</span>}
                  </div>
                </div>

                {flowError && <div className="text-sm text-red-600">{flowError}</div>}
              </div>

              <DialogFooter className="mt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep("terms");
                    setFlowError(null);
                    setShowOtpKb(false);
                  }}
                >
                  กลับ
                </Button>
                <Button onClick={handleVerifyOtp} disabled={!/^\d{6}$/.test(otp || "") || sending}>
                  {sending ? (<><Loader size={16} className="mr-2" />กำลังยืนยัน…</>) : ("ยืนยันรหัส")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
