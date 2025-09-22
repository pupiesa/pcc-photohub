// app/booth/page.js
"use client";

import { useEffect, useRef, useState } from "react";
import { client } from "@/lib/photoboothClient";
import { WarpBackground } from "@/components/ui/shadcn-io/warp-background";
import { GradientText } from "@/components/ui/shadcn-io/gradient-text";
import StartCard from "@/components/IndexCard";
import PhoneLoginCard from "@/components/PhoneLoginCard";
import PhotoboothInterface from "@/components/PhotoboothInterface";
import ForgotPinDialog from "@/components/ForgotPinDialog";
import PromotionCard from "@/components/promotionCard";

const WARP_CONFIG = { perspective: 150, beamsPerSide: 4, beamSize: 5, beamDuration: 1 };

const MONGO_BASE = process.env.NEXT_PUBLIC_MONGO_BASE || "";
const NC_BASE = process.env.NEXT_PUBLIC_NC_BASE || "";
const CAMERA_BASE = process.env.NEXT_PUBLIC_CAMERA_BASE || "";

const RETRY_MS = 30000;
const PROG_TICK = 100;
const PROG_STEP = 100 / (RETRY_MS / PROG_TICK);
const BASE_ORDER_AMOUNT = 50;
const EXPIRE_SECONDS = 120; // ✅ นับถอยหลัง 120 วิ

function SuccessTick() {
  return (
    <span className="inline-block">
      <svg viewBox="0 0 52 52" className="w-6 h-6">
        <circle className="ckmk-circle" cx="26" cy="26" r="24" fill="none" strokeWidth="3" />
        <path className="ckmk-check" fill="none" strokeWidth="4" d="M14 27 l8 8 16-16" />
      </svg>
    </span>
  );
}

async function ping(base, path = "/api/health", timeout = 2500) {
  if (!base) return false;
  const url = `${base.replace(/\/$/, "")}${path}`;
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeout);
  try {
    await fetch(url, { method: "GET", signal: ac.signal, cache: "no-store" });
    return true;
  } catch {
    try {
      await fetch(base, { method: "GET", signal: ac.signal, cache: "no-store" });
      return true;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(id);
  }
}

export default function BoothPage() {
  const [currentView, setCurrentView] = useState("start"); // "start" | "login" | "Coupon" | "photobooth"
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);

  const [wrongCount, setWrongCount] = useState(0);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotPhone, setForgotPhone] = useState("");

  // Notice/Toast
  const [notice, setNotice] = useState(null);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const hideTimerRef = useRef(null);
  const removeTimerRef = useRef(null);
  const progressTimerRef = useRef(null);

  const clearTimers = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    hideTimerRef.current = null; removeTimerRef.current = null; progressTimerRef.current = null;
  };

  const showNotice = (text, variant = "success", sticky = false, ms = 5000) => {
    clearTimers();
    setNotice({ text, variant, sticky });
    setNoticeVisible(true);
    setProgress(100);
    const duration = sticky ? RETRY_MS : ms;
    const step = sticky ? PROG_STEP : 100 / (duration / PROG_TICK);
    progressTimerRef.current = setInterval(() => setProgress((p) => Math.max(0, p - step)), PROG_TICK);
    if (!sticky) {
      hideTimerRef.current = setTimeout(() => setNoticeVisible(false), duration);
      removeTimerRef.current = setTimeout(() => { setNotice(null); clearTimers(); }, duration + 700);
    }
  };
  const clearNotice = () => { clearTimers(); setNoticeVisible(false); setTimeout(() => setNotice(null), 700); };
  useEffect(() => () => clearTimers(), []);

  // Promo + payment state
  const [promos, setPromos] = useState([]);
  const [qrUrl, setQrUrl] = useState("");
  const [piId, setPiId] = useState("");
  const [payStatus, setPayStatus] = useState("");
  const [loadingPay, setLoadingPay] = useState(false);
  const [showPay, setShowPay] = useState(false);

  // Countdown
  const [timeLeft, setTimeLeft] = useState(0);
  const countdownRef = useRef(null);

  const resetPayUi = () => {
    setShowPay(false);
    setQrUrl(""); setPiId(""); setPayStatus("");
    setTimeLeft(0);
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  };

  // load promos
  useEffect(() => {
    (async () => {
      try {
        const result = await client.listPromos({ active: true });
        setPromos(Array.isArray(result.data) ? result.data : result.data?.promos || []);
      } catch (e) {
        console.error("Fetch promos failed:", e.message);
        showNotice("โหลดคูปองไม่สำเร็จ", "warn", false, 4000);
      }
    })();
  }, []);

  // monitor upstreams
  const [isOffline, setIsOffline] = useState(false);
  const [downList, setDownList] = useState([]);
  useEffect(() => {
    let mounted = true;
    let intervalId;
    const checkApis = async () => {
      setProgress(100);
      const bad = [];
      const okMongo = await ping(MONGO_BASE); if (!okMongo) bad.push("DATABASE");
      const okNc = await ping(NC_BASE); if (!okNc) bad.push("CLOUD");
      const okCam = await ping(CAMERA_BASE, "/", 2500); if (!okCam) bad.push("CAMERA");
      if (!mounted) return;
      if (bad.length > 0) {
        setIsOffline(true); setDownList(bad);
        showNotice(`Cannot reach: ${bad.join(", ")}`, "warn", true);
      } else {
        if (isOffline) { setIsOffline(false); setDownList([]); clearNotice(); showNotice("Back online", "success", false, 3000); }
      }
    };
    checkApis();
    intervalId = setInterval(checkApis, RETRY_MS);
    return () => { mounted = false; if (intervalId) clearInterval(intervalId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [MONGO_BASE, NC_BASE, CAMERA_BASE, isOffline]);

  // route helpers
  const handleStartClick = () => { setCurrentView("login"); resetPayUi(); };
  const handleBackToStart = () => { setCurrentView("start"); resetPayUi(); };

  // ถ้าชำระเงินไม่สำเร็จ → แจ้ง 5 วิ แล้วกลับ login
  const backToLoginOnFail = (msg = "ชำระเงินไม่สำเร็จ กรุณาลองใหม่") => {
    showNotice(msg, "error", false, 5000);
    setCurrentView("login");
    resetPayUi();
  };

  const handleLogin = async ({ phone, pin }) => {
    setBusy(true);
    try {
      await client.ensureUserAndPin({ number: phone, pin });
      setUser({ phone });
      setCurrentView("Coupon");
      resetPayUi();
      showNotice("Signed in", "success", false, 3000);
      setWrongCount(0);
    } catch (e) {
      const nextWrong = wrongCount + 1;
      setWrongCount(nextWrong);
      if (nextWrong >= 3) {
        setForgotPhone(phone);
        setForgotOpen(true);
      }
      showNotice(`Login failed: ${e.message || "REQUEST_FAILED"}`, "warn", false, 5000);
    } finally { setBusy(false); }
  };

  const handleLogout = () => { setUser(null); setCurrentView("start"); resetPayUi(); showNotice("Signed out", "success", false, 3000); };

  // helper แปลงวินาทีเป็น mm:ss
  const mmss = (s) => {
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  // หมดเวลา → ยกเลิก session ที่ backend
  const expireSessionNow = async () => {
    if (!piId) return;
    try { await fetch(`/api/pay/${piId}`, { method: "DELETE" }); } catch {}
    backToLoginOnFail("หมดเวลา 120 วินาที กรุณาลองใหม่");
  };

  // --- เริ่มจ่าย (validate + popup + แสดง QR + start countdown) ---
  const startPayment = async (codeOrPromo) => {
    if (!user?.phone) { showNotice("กรุณาเข้าสู่ระบบก่อน", "warn", false, 3000); return; }

    setLoadingPay(true);
    setQrUrl(""); setPiId(""); setPayStatus("");

    try {
      const couponCode = typeof codeOrPromo === "string" ? codeOrPromo.trim() : codeOrPromo?.code;

      let before = BASE_ORDER_AMOUNT;
      let discount = 0;
      let after = BASE_ORDER_AMOUNT;

      if (couponCode) {
        try {
          const v = await client.validatePromo(couponCode, {
            userNumber: user?.phone,
            orderAmount: BASE_ORDER_AMOUNT,
          });
          const pricing = v?.data?.pricing || {};
          before = Number(pricing.amount_before ?? BASE_ORDER_AMOUNT);
          discount = Math.max(0, Number(pricing.discount_amount || 0));
          after = Math.max(0, Number(pricing.amount_after ?? before - discount));
          showNotice(`ใช้คูปองสำเร็จ • ลด ฿${discount} จาก ฿${before} → เหลือ ฿${after}`, "success", false, 3000);
        } catch {
          showNotice("คูปองไม่ถูกต้อง/หมดอายุ", "warn", false, 4000);
          return;
        }
      } else {
        showNotice(`ไม่มีคูปอง • ยอดสุทธิ ฿${BASE_ORDER_AMOUNT}`, "success", false, 2200);
      }

      const r = await fetch("/api/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promoCode: couponCode || null,
          userNumber: user?.phone,
          orderAmount: BASE_ORDER_AMOUNT,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.message || "PAY_CREATE_FAILED");

      setQrUrl(data.qr);
      setPiId(data.paymentIntentId);
      setPayStatus("requires_payment_method");
      setShowPay(true);

      if (typeof data.amountTHB === "number") {
        showNotice(`ยอดเรียกเก็บจริง ฿${data.amountTHB}`, "success", false, 2500);
      }

      // start 120s countdown
      setTimeLeft(EXPIRE_SECONDS);
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
            // หมดเวลา → expire session
            expireSessionNow();
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    } catch (e) {
      console.error("Create pay failed:", e.message);
      backToLoginOnFail("สร้างการชำระเงินไม่สำเร็จ");
    } finally {
      setLoadingPay(false);
    }
  };

  // Poll สถานะ (สําเร็จ/ล้มเหลว)
  useEffect(() => {
    if (!piId) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/pay/${piId}`);
        const d = await r.json();
        if (d.ok) {
          setPayStatus(d.status);

          if (d.status === "succeeded") {
            showNotice("ชำระเงินสำเร็จ", "success", false, 3000);
            if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
            setCurrentView("photobooth");
            resetPayUi();
            stop = true;
          } else if (["canceled", "requires_payment_method"].includes(d.status)) {
            if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
            backToLoginOnFail("ชำระเงินไม่สำเร็จ กรุณาลองใหม่");
            stop = true;
          }
        } else {
          if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
          backToLoginOnFail("ไม่สามารถตรวจสอบสถานะการชำระเงินได้");
          stop = true;
        }
      } catch {
        if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
        backToLoginOnFail("เครือข่ายขัดข้อง กรุณาลองใหม่");
        stop = true;
      }
      if (!stop) setTimeout(tick, 2500);
    };
    tick();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piId]);

  // UI โค้ดคูปอง/QR
  const renderCouponOrPayment = () => {
    if (showPay) {
      const pct = Math.max(0, Math.min(100, (timeLeft / EXPIRE_SECONDS) * 100));
      return (
        <div className="flex flex-col items-center justify-center flex-1 w-full">
          {loadingPay && <p className="text-sm opacity-70">Creating payment…</p>}
          {qrUrl && (
            <div className="mt-2 p-5 rounded-2xl border bg-white/90 dark:bg-gray-900/70 shadow-md w-[320px]">
              <p className="text-sm font-medium mb-3 text-center">สแกนด้วยแอปธนาคาร (PromptPay)</p>
              <img src={qrUrl} alt="PromptPay QR" className="w-64 h-64 mx-auto" />
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="opacity-70">หมดเวลาใน</span>
                  <span className="font-semibold">{mmss(timeLeft)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                  <div
                    className="h-2 bg-gradient-to-r from-rose-400 via-amber-400 to-emerald-400"
                    style={{ width: `${pct}%`, transition: "width 1s linear" }}
                  />
                </div>
              </div>
              <div className="text-xs text-center mt-2 opacity-70">Status: {payStatus || "—"}</div>

              {/* ปุ่มยกเลิกเองก่อนหมดเวลา */}
              <button
                onClick={expireSessionNow}
                className="mt-3 w-full py-2 text-sm rounded-md border border-rose-300 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/20 dark:hover:bg-rose-900/30 transition"
                title="ยกเลิกการชำระเงิน"
              >
                ยกเลิกการชำระเงิน
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center gap-4 w-full max-w-[720px]">
        Logged in as: {user?.phone || "Unknown"}
        <div className="w-full">
          {promos.map((p) => (
            <PromotionCard
              key={p.code}
              details={{
                type: p.type, value: p.value,
                startAt: p.start_at, endAt: p.end_at,
                usageLimit: p.usage_limit, usedCount: p.used_count,
                perUserLimit: p.per_user_limit,
              }}
              onRedeem={(code) => startPayment(code)}
            />
          ))}
        </div>
        <div className="w-full max-w-[320px]">
          <button
            onClick={() => startPayment(null)}
            disabled={loadingPay}
            className={`w-full py-2 px-4 rounded-md border text-sm font-medium transition
              ${loadingPay
                ? "bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed"
                : "border-dashed border-gray-400 hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
            title="ไม่มีคูปอง กดข้ามไปชำระเงิน"
          >
            ไม่มีคูปอง — ข้ามไปชำระเงินเลย
          </button>
        </div>
      </div>
    );
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case "login":
        return (
          <PhoneLoginCard
            onBack={handleBackToStart}
            onLogin={busy ? () => {} : handleLogin}
            onForgotPin={(phone) => { setForgotPhone(phone); setForgotOpen(true); }}
          />
        );
      case "Coupon":
        return renderCouponOrPayment();
      case "photobooth":
        return (
          <div className="flex flex-col items-center">
            <PhotoboothInterface user={user} onLogout={handleLogout} />
          </div>
        );
      default:
        return <StartCard onStartClick={handleStartClick} />;
    }
  };

  const colorBar =
    notice?.variant === "success" ? "from-emerald-400 to-lime-400"
    : notice?.variant === "error" ? "from-rose-400 to-red-500"
    : "from-amber-400 to-yellow-400";
  const cardColor =
    notice?.variant === "success" ? "bg-white/85 dark:bg-gray-900/85 border-emerald-300/60"
    : notice?.variant === "error" ? "bg-white/85 dark:bg-gray-900/85 border-rose-300/60"
    : "bg-white/85 dark:bg-gray-900/85 border-amber-300/60";

  const retryNow = async () => {
    setProgress(100);
    const bad = [];
    const okMongo = await ping(MONGO_BASE); if (!okMongo) bad.push("DATABASE");
    const okNc = await ping(NC_BASE); if (!okNc) bad.push("CLOUD");
    if (bad.length > 0) {
      setIsOffline(true); setDownList(bad);
      showNotice(`Cannot reach: ${bad.join(", ")}`, "warn", true);
    } else {
      setIsOffline(false); setDownList([]); clearNotice(); showNotice("Back online", "success", false, 3000);
    }
  };

  return (
    <WarpBackground className="h-screen flex flex-col" {...WARP_CONFIG}>
      <div className="text-center pt-8">
        <GradientText
          className="text-4xl font-bold text-center"
          text="Pcc-Photohub"
          neon
          gradient="linear-gradient(90deg, #00ff00 0%, #00ffff 25%, #ff00ff 50%, #00ffff 75%, #00ff00 100%)"
        />
      </div>

      {/* Toast */}
      {notice && (
        <div className={`fixed top-5 right-5 z-50 transition-opacity duration-700 ${noticeVisible ? "opacity-100" : "opacity-0"}`}>
          <div className={`min-w-[260px] max-w-[360px] rounded-xl shadow-xl border backdrop-blur px-4 py-3
            ${cardColor} text-sm font-medium tracking-tight text-gray-900 dark:text-gray-100`}>
            <div className={`h-1 w-full rounded-full bg-gradient-to-r ${colorBar} mb-2`}
              style={{ width: `${progress}%`, transition: `width ${PROG_TICK}ms linear` }} />
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {notice.variant === "success" && (
                  <span className="text-emerald-600 dark:text-emerald-400"><SuccessTick /></span>
                )}
                <span>{notice.text}</span>
              </div>
              {notice.variant === "warn" && (
                <button
                  onClick={retryNow}
                  className="ml-2 px-2 py-1 text-xs rounded-md border border-amber-400/60 bg-amber-50/60 dark:bg-amber-900/20 hover:bg-amber-100/70 dark:hover:bg-amber-900/30 transition"
                >
                  Retry
                </button>
              )}
            </div>
            {notice.sticky && downList.length > 0 && <div className="mt-1 text-xs opacity-80">{downList.join(" • ")}</div>}
          </div>

          <style jsx global>{`
            .ckmk-circle, .ckmk-check {
              stroke: currentColor;
              stroke-linecap: round;
              stroke-linejoin: round;
            }
            .ckmk-circle {
              stroke-dasharray: 150;
              stroke-dashoffset: 150;
              animation: ckmk-draw 0.55s ease-out forwards; opacity: .9;
            }
            .ckmk-check {
              stroke-dasharray: 40;
              stroke-dashoffset: 40;
              animation: ckmk-draw 0.35s 0.35s ease-out forwards;
            }
            @keyframes ckmk-draw { to { stroke-dashoffset: 0; } }
          `}</style>
        </div>
      )}

      <div className="flex-1 flex justify-center mt-10 px-10">{renderCurrentView()}</div>

      <ForgotPinDialog
        open={forgotOpen}
        onOpenChange={setForgotOpen}
        phone={forgotPhone}
        afterReset={() => { setCurrentView("login"); setWrongCount(0); showNotice("โปรดใช้ PIN ใหม่ในการเข้าสู่ระบบ", "success", false, 3000); }}
      />
    </WarpBackground>
  );
}
