// app/dashboard/page.js
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import { Progress } from "@/components/ui/progress";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { BackgroundGradient } from "@/components/ui/shadcn-io/background-gradient";
import { GradientText } from "@/components/ui/shadcn-io/gradient-text";
import { Eye, EyeOff } from "lucide-react";
import { InlineEmailKeyboard, InlineOtpKeypad } from "@/components/dashboard/InlineKeyboards";
import TermsLegal from "@/components/dashboard/TermsLegal";
import GalleryLightboxCard from "@/components/dashboard/GalleryLightboxCard";
import { Navbar03 } from "@/components/ui/shadcn-io/navbar-03";

/* ---------- helpers ---------- */
const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const PRINT_HOST = process.env.PRINT_API_HOST || "127.0.0.1";
const PRINT_PORT = process.env.PRINT_API_PORT || "5000";
const PRINT_BASE = `http://${PRINT_HOST}:${PRINT_PORT}`;

const OTP_TOTAL_SECS = (parseInt(process.env.OTP_TTL_MIN) || 1) * 60;

// แปลงชื่อไฟล์ capture_YYYYMMDD_HHMMSS.jpg → timestamp (ms)
// ถ้า parse ไม่ได้ให้คืน 0 (จะไปอยู่ท้าย)
function tsFromFilename(nameOrPath) {
  const s = String(nameOrPath || "");
  // รองรับทั้ง path และ filename
  const m = s.match(/capture_(\d{8})_(\d{6})/);
  if (!m) return 0;
  const d = m[1]; // YYYYMMDD
  const t = m[2]; // HHMMSS
  const ts = Date.UTC(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    Number(t.slice(0, 2)),
    Number(t.slice(2, 4)),
    Number(t.slice(4, 6))
  );
  return isNaN(ts) ? 0 : ts;
}

/* ---------- Page ---------- */
export default function CustomerDashboard() {
  const router = useRouter();

  const [phone, setPhone] = useState(null);
  const [pin, setPin] = useState(null);
  const [showPin, setShowPin] = useState(false);

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
  const isUrgent = otpSecsLeft > 0 && otpSecsLeft <= 25;

  // soft keyboards
  const [showEmailKb, setShowEmailKb] = useState(false);
  const [showOtpKb, setShowOtpKb] = useState(false);

  const emailInputRef = useRef(null);
  const otpFirstSlotRef = useRef(null);

  const safeSelectAll = (el) => {
    try { if (el?.setSelectionRange) el.setSelectionRange(0, el.value?.length ?? 0); } catch {}
  };

  // อ่าน phone/pin จาก localStorage
  useEffect(() => {
    const p = typeof window !== "undefined" ? localStorage.getItem("pcc_user_phone") : null;
    const pn = typeof window !== "undefined" ? localStorage.getItem("pcc_user_pin") : null;
    if (p) setPhone(p);
    if (pn) setPin(pn);
  }, []);

  // โหลดข้อมูล + เรียงรูปใหม่สุดก่อน
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

      //เรียงใหม่สุดก่อนด้วยชื่อไฟล์ capture_YYYYMMDD_HHMMSS
      const sorted = onlyImages
        .map((it) => ({ ...it, __ts: tsFromFilename(it?.name || it?.path || "") }))
        .sort((a, b) => b.__ts - a.__ts)
        .map(({ __ts, ...rest }) => rest);

      setGallery(sorted);
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
  const INACTIVITY_MS = 300000; // 5 minutes
  const logout = useCallback(() => {
    fetch(`${PRINT_BASE}/play/thankyou.wav`);
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

    const events = ["pointerdown", "keydown", "mousemove", "wheel", "touchstart", "scroll"];
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
      //console.error(e);
      if (isDuplicateEmailError(e)) {
        toast.error("อีเมลนี้ถูกใช้แล้ว โปรดใช้อีเมลอื่น", { duration: 5000 });
        setStep("email");
        setTimeout(() => emailInputRef.current?.focus({ preventScroll: true }), 30);
        return;
      }
      setFlowError(e?.message || "ส่งรหัส OTP ล้มเหลว กรุณาลองใหม่");
      toast.error(e?.message || "ส่งรหัส OTP ล้มเหลว");
    } finally { setSending(false); }
  };

  const handleResend = async () => {
    if (!canResend || sending || !phone) return;
    setSending(true);
    try {
      await client.requestEmailOTP({ number: phone, email: email.trim(), heading: 'Verify your email' });
      setOtp("");
      setOtpSecsLeft(OTP_TOTAL_SECS);
      setOtpTimerKey((k) => k + 1);
      setCanResend(false);
      toast.success("ส่งรหัส OTP ใหม่แล้ว ตรวจอีเมลของคุณ");
    } catch (e) {
      //console.error(e);
      setFlowError(e?.message || "ส่งรหัส OTP ล้มเหลว กรุณาลองใหม่");
      toast.error(e?.message || "ส่งรหัส OTP ล้มเหลว");
    } finally { setSending(false); }
  };

  const handleVerifyOtp = async () => {
  if (!/^\d{6}$/.test(otp) || !phone || sending) return;
  setFlowError(null); setSending(true);
  try {
    // 1) ยืนยัน OTP + บันทึกอีเมล + ยอมรับเงื่อนไข
    await client.confirmEmailOTP({ number: phone, email: email.trim(), otp });
    await client.setGmail(phone, email.trim());
    await client.setConsentedTrue(phone);

    // 2) ตรวจว่ามีลิงก์ Nextcloud เดิมอยู่หรือไม่
    let existingLink = null;
    try {
      const u = await client.getUserByNumber(phone);
      existingLink = u?.data?.nextcloud_link || null;
    } catch {}

    // 3) ถ้ามีลิงก์แล้ว ⇒ เปลี่ยนรหัสผ่านของลิงก์เป็นหมายเลขโทรศัพท์
    if (existingLink) {
      try {
        await client.changeSharePasswordForUser({
          number: phone,
          newPassword: phone,       // รหัสผ่าน = เบอร์โทรผู้ใช้
          permissions: 1,
          publicUpload: false,
          note: `PCC PhotoHub Share for ${email.trim()})`,
        });
        // ไม่ต้องอัปเดตลิงก์ใน DB เพราะลิงก์เดิมยังใช้ได้เหมือนเดิม (แค่เปลี่ยนรหัสผ่าน)
        //toast.success("ลิงก์สำหรับแชร์รูปภาพสำเร็จ");
      } catch (err) {
        console.log("Nextcloud change password error:", err);
        toast.error("เปลี่ยนรหัสผ่านลิงก์แชร์ไม่สำเร็จ");
      }
    } else {
      // 4) ถ้ายังไม่มีลิงก์ ⇒ สร้างลิงก์ใหม่ พร้อมตั้งรหัสเป็นเบอร์โทร
      try {
        const shareRes = await client.shareOnlyForUser({
          number: phone,
          linkPassword: phone,     // รหัสผ่าน = เบอร์โทรผู้ใช้
          permissions: 1,
          publicUpload: false,
          note: `PCC PhotoHub Share for ${email.trim()}`,
          forceNew: true,
        });

        if (shareRes?.link) {
          await client.setNextcloudLink(phone, shareRes.link);
          toast.success("สร้างลิงก์แชร์สำเร็จ");
        } else {
          toast.warning("สร้างลิงก์ไม่สำเร็จ แต่ยืนยันอีเมลแล้ว");
        }
      } catch (err) {
        console.log("Nextcloud share error:", err);
        toast.error("ไม่สามารถสร้างลิงก์แชร์ได้");
      }
    }

    toast.success("ยืนยันอีเมลสำเร็จ");
    setOpenEmailFlow(false);
    setStep("email");
    setShowOtpKb(false);
    refresh();
  } catch (e) {
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
          <Button variant="outline" onClick={refresh} disabled={loading}>
            {loading ? (<><Loader size={16} className="mr-2" />Loading…</>) : ("Refresh")}
          </Button>
        </div>
      </div>
      
      <div className="w-full max-w-5xl px-4 grid grid-cols-1 md:grid-cols-3 gap-4">
       {/* PHOTOS (scrollable + lightbox) */}
          <GalleryLightboxCard
            title="Photos"
            description={
              phone ? `Phone: ${phone} ${summary.count ? `• Total: ${summary.count}` : ""}` : "Loading…"
            }
            gallery={gallery}
            heightClass="h-[50vh]"
          />

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

            {/* PIN */}
            <div className="text-sm">
              <div className="text-gray-500 dark:text-gray-400">Pin</div>
              <div className="font-medium flex items-center gap-2">
                <span className="font-mono tracking-wider select-none">
                  {pin ? (showPin ? pin : "••••••") : "-"}
                </span>
                {pin && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setShowPin((v) => !v)}
                    aria-label={showPin ? "Hide PIN" : "Show PIN"}
                    className="h-8 w-8 shadow-lg shadow-cyan-500 hover:shadow-purple-500 hover:opacity-80"
                  >
                    {showPin ? <Eye className="h-4 w-4 text-green-700" /> : <EyeOff className="h-4 w-4 text-red-700" />}
                  </Button>
                )}
              </div>
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
                  <div className="font-medium">ยืนยันอีเมลเพื่อใช้ยืนยันตัวตนและกู้คืน PIN</div>
                  <Button onClick={() => {
                    setFlowError(null); setEmail(""); setConsent(false); setOtp("");
                    setStep("email"); setOpenEmailFlow(true);
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
          }
        }}
      >
        <DialogContent className="sm:max-w-166">
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
                    onDone={() => setShowEmailKb(false)}
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
            <TermsLegal
              consent={consent}
              setConsent={setConsent}
              flowError={flowError}
              sending={sending}
              onBack={() => {
                setStep("email");
                setFlowError(null);
                setShowEmailKb(true);
              }}
              onNext={handleSendOtp}
            />
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
                      {[0, 1, 2, 3, 4, 5].map((i) => (
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