// app/booth/page.js
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { client } from "@/lib/photoboothClient";
import { WarpBackground } from "@/components/ui/shadcn-io/warp-background";
import { GradientText } from "@/components/ui/shadcn-io/gradient-text";
import StartCard from "@/components/IndexCard";
import PhoneLoginCard from "@/components/PhoneLoginCard";
import PhotoboothInterface from "@/components/PhotoboothInterface";
import ForgotPinDialog from "@/components/ForgotPinDialog";
import PromotionSuccessCard from "@/components/PromotionSuccessCard";
import CouponPaymentPanel from "@/components/CouponPaymentPanel";


const PRINT_HOST = process.env.PRINT_API_HOST || "127.0.0.1";
const PRINT_PORT = process.env.PRINT_API_PORT || "5000";
const PRINT_BASE = `http://${PRINT_HOST}:${PRINT_PORT}`;

const WARP_CONFIG = { perspective: 150, beamsPerSide: 4, beamSize: 5, beamDuration: 1 };

const MONGO_BASE = process.env.NEXT_PUBLIC_MONGO_BASE || "";
const NC_BASE = process.env.NEXT_PUBLIC_NC_BASE || "";
const CAMERA_BASE = process.env.NEXT_PUBLIC_CAMERA_BASE || "";

const RETRY_MS = 30000;
const PROG_TICK = 100;
const PROG_STEP = 100 / (RETRY_MS / PROG_TICK);
const BASE_ORDER_AMOUNT = 50;   // ฐานราคาเดิม (ใช้คำนวณส่วนลดที่โชว์บนการ์ด)
const EXPIRE_SECONDS = 120;     // หมดเวลา QR
const AUTO_REDEEM_LEN = 8;      // รหัสคูปอง 8 ตัว

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

  // Forgot PIN
  const [wrongCount, setWrongCount] = useState(0);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotPhone, setForgotPhone] = useState("");

  // Toast/Notice
  const [notice, setNotice] = useState(null);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const hideTimerRef = useRef(null);
  const removeTimerRef = useRef(null);
  const progressTimerRef = useRef(null);

  // Payment state
  const [qrUrl, setQrUrl] = useState("");
  const [piId, setPiId] = useState("");
  const [payStatus, setPayStatus] = useState("");
  const [loadingPay, setLoadingPay] = useState(false);
  const [showPay, setShowPay] = useState(false);

  // QR Expire Countdown
  const [timeLeft, setTimeLeft] = useState(0);
  const countdownRef = useRef(null);

  // Coupon UI (focus + lock 8 + auto-redeem)
  const [couponInput, setCouponInput] = useState("");
  const couponRef = useRef(null);
  const autoTimerRef = useRef(null);
  const autoFiredRef = useRef(false);

  // การ์ดโปรโมชัน
  const [promoCard, setPromoCard] = useState({ show: false, amount: 0, isFree: false });

  // Monitor upstreams
  const [isOffline, setIsOffline] = useState(false);
  const [downList, setDownList] = useState([]);

  // Auto logout
  const deadlineRef = useRef(0);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const INACTIVITY_MS = 120000;   // 2 นาที

  // Functions
  const clearTimers = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    hideTimerRef.current = null;
    removeTimerRef.current = null;
    progressTimerRef.current = null;
  };
  const showNotice = (text, variant = "success", sticky = false, ms = 5000) => {
    clearTimers();
    setNotice({ text, variant, sticky });
    setNoticeVisible(true);
    setProgress(100);
    const duration = sticky ? RETRY_MS : ms;
    const step = sticky ? PROG_STEP : 100 / (duration / PROG_TICK);
    progressTimerRef.current = setInterval(
      () => setProgress((p) => Math.max(0, p - step)),
      PROG_TICK
    );
    if (!sticky) {
      hideTimerRef.current = setTimeout(() => setNoticeVisible(false), duration);
      removeTimerRef.current = setTimeout(() => {
        setNotice(null);
        clearTimers();
      }, duration + 700);
    }
  };
  const clearNotice = () => {
    clearTimers();
    setNoticeVisible(false);
    setTimeout(() => setNotice(null), 700);
  };

  const mmss = (s) => {
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  const resetIdle = useCallback(() => {
    deadlineRef.current = Date.now() + INACTIVITY_MS;
    setSecondsLeft(Math.ceil(INACTIVITY_MS / 1000));
  }, []);

  const resetPayUi = () => {
    setShowPay(false);
    setQrUrl(""); setPiId(""); setPayStatus("");
    setTimeLeft(0);
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  };

  const backToLoginOnFail = (msg = "ชำระเงินไม่สำเร็จ กรุณาลองใหม่") => {
    showNotice(msg, "error", false, 5000);
    setCurrentView("start");
    resetPayUi();
  };

  const handleStartClick = () => { setCurrentView("login"); resetPayUi(); };
  const handleBackToStart = () => { setCurrentView("start"); resetPayUi(); };
  const handleLogin = async ({ phone, pin }) => {
    setBusy(true);
    try {
      await client.ensureUserAndPin({ number: phone, pin });
      setUser({ phone });
      if (typeof window !== "undefined") {
        localStorage.setItem("pcc_user_phone", String(phone));
        localStorage.setItem("pcc_user_pin", String(pin));
      }
      fetch(`${PRINT_BASE}/play/promo.wav`);
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
  const handleLogout = useCallback(() => {
    try {
      localStorage.removeItem("pcc_user_phone");
      localStorage.removeItem("pcc_user_pin");
    } catch {}
    setUser(null);
    setCurrentView("start");
    resetPayUi();
    showNotice("Signed out", "success", false, 3000);
  }, []);

  const onCouponChange = (v) => {
    const filtered = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, AUTO_REDEEM_LEN);
    setCouponInput(filtered);
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);

    if (filtered.length === AUTO_REDEEM_LEN && !autoFiredRef.current) {
      autoFiredRef.current = true;
      autoTimerRef.current = setTimeout(async () => {
        try {
          await client.validatePromo(filtered, {
            userNumber: user?.phone,
            orderAmount: BASE_ORDER_AMOUNT,
          });
          await startPayment(filtered);
        } catch {
          showNotice("คูปองไม่ถูกต้อง/หมดอายุ", "warn", false, 1800);
          setCouponInput("");
          requestAnimationFrame(() => {
            couponRef.current?.focus?.({ preventScroll: true });
          });
          autoFiredRef.current = false;
        }
      }, 120);
    } else {
      autoFiredRef.current = false;
    }
  };

  const startPayment = async (code) => {
  if (!user?.phone) { showNotice("กรุณาเข้าสู่ระบบก่อน", "warn", false, 3000); return; }

  setLoadingPay(true);
  setQrUrl(""); setPiId(""); setPayStatus("");
  try {
    const couponCode = (typeof code === "string" ? code : "")?.trim();

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

    const amountTHB = Number(data.amountTHB);
    const discountTHB = Math.max(0, BASE_ORDER_AMOUNT - (isNaN(amountTHB) ? BASE_ORDER_AMOUNT : amountTHB));
    const usedCoupon = Boolean(couponCode);
    const couponSucceeded = usedCoupon && discountTHB > 0;

    if (couponSucceeded) {
      setCouponInput("");                      
      autoFiredRef.current = false;          
      requestAnimationFrame(() => {
        couponRef.current?.focus?.({ preventScroll: true });
      });

      const isFree = amountTHB === 0;
      setPromoCard({ show: true, amount: discountTHB, isFree });
      setQrUrl(data.qr || "");
      setPiId(data.paymentIntentId || "");
      setPayStatus(data.amountTHB === 0 ? "succeeded" : "requires_action");
      return;
    }

    if (amountTHB === 0) {
      setCouponInput("");                      
      setCurrentView("photobooth");
      resetPayUi();
      return;
    }

    fetch(`${PRINT_BASE}/play/pay.wav`);
    setQrUrl(data.qr);
    setPiId(data.paymentIntentId);
    setPayStatus("requires_action");
    setShowPay(true);

    setTimeLeft(EXPIRE_SECONDS);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
          expireSessionNow();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  } catch (e) {
    console.error("Create pay failed:", e);
    const couponCode = (typeof code === "string" ? code : "")?.trim();
    if (couponCode && couponCode.length === AUTO_REDEEM_LEN) {
      showNotice("คูปองไม่ถูกต้อง/หมดอายุ", "warn", false, 1800);
      setShowPay(false);
      setQrUrl(""); setPiId(""); setPayStatus("");
      setCouponInput("");                       
      requestAnimationFrame(() => {
        couponRef.current?.focus?.({ preventScroll: true });
      });
      return;
    }
    backToLoginOnFail("สร้างการชำระเงินไม่สำเร็จ");
  } finally {
    setLoadingPay(false);
  }
};

  const expireSessionNow = async () => {
    if (!piId) { backToLoginOnFail("หมดเวลา กรุณาลองใหม่"); return; }
    try { await fetch(`/api/pay/${piId}`, { method: "DELETE" }); } catch {}
    backToLoginOnFail("หมดเวลา 120 วินาที กรุณาลองใหม่");
  };

  const retryNow = async () => {
    setProgress(100);
    const bad = [];
    const okMongo = await ping(MONGO_BASE); if (!okMongo) bad.push("DATABASE");
    const okNc    = await ping(NC_BASE);    if (!okNc)  bad.push("CLOUD");
    if (bad.length > 0) {
      setIsOffline(true); setDownList(bad);
      showNotice(`Cannot reach: ${bad.join(", ")}`, "warn", true);
    } else {
      setIsOffline(false); setDownList([]); clearNotice();
      showNotice("Back online", "success", false, 3000);
    }
  };

  const renderCouponOrPayment = () => {
    return (
      <CouponPaymentPanel
        showPay={showPay}

        // Coupon mode
        couponValue={couponInput}
        onCouponChange={(v) => onCouponChange(v)}
        onRedeem={() => startPayment(couponInput)}
        onSkipNoCoupon={() => startPayment("")}
        onLogout={handleLogout}
        loading={loadingPay}
        codeLength={AUTO_REDEEM_LEN}

        // Payment mode
        qrUrl={qrUrl}
        payStatus={payStatus}
        timeLeft={timeLeft}
        expireSeconds={EXPIRE_SECONDS}
        formatTime={mmss}
        logoSrc={"/image/Thai_QR_Payment_Logo-01.jpg"} // โลโก้ Thai QR Payment
      />
    );
  };

  const colorBar =
    notice?.variant === "success" ? "from-emerald-400 to-lime-400"
    : notice?.variant === "error" ? "from-rose-400 to-red-500"
    : "from-amber-400 to-yellow-400";
  const cardColor =
    notice?.variant === "success" ? "bg-white/85 dark:bg-gray-900/85 border-emerald-300/60"
    : notice?.variant === "error" ? "bg-white/85 dark:bg-gray-900/85 border-rose-300/60"
    : "bg-white/85 dark:bg-gray-900/85 border-amber-300/60";

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

  // useEffects
  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    let mounted = true;
    let intervalId;
    const checkApis = async () => {
      const bad = [];
      const okMongo = await ping(MONGO_BASE); if (!okMongo) bad.push("DATABASE");
      const okNc    = await ping(NC_BASE);    if (!okNc)  bad.push("CLOUD");
      const okCam   = await ping(CAMERA_BASE, "/", 2500); if (!okCam) bad.push("CAMERA");
      if (!mounted) return;
      if (bad.length > 0) {
        setIsOffline(true);
        setDownList(bad);
        showNotice(`Cannot reach: ${bad.join(", ")}`, "warn", true);
      } else {
        if (isOffline) {
          setIsOffline(false); setDownList([]); clearNotice();
          showNotice("Back online", "success", false, 3000);
        }
      }
    };
    checkApis();
    intervalId = setInterval(checkApis, RETRY_MS);
    return () => { mounted = false; if (intervalId) clearInterval(intervalId); };
  }, [MONGO_BASE, NC_BASE, CAMERA_BASE, isOffline]);

  useEffect(() => {
    // ทำงานเฉพาะหน้า start, login, และ Coupon (เมื่อไม่ showPay และไม่ promoCard.show)
    if (!["login", "Coupon"].includes(currentView) || showPay || promoCard.show) {
      setSecondsLeft(null);
      return;
    }

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
        handleLogout();
      }
    }, 1000);

    return () => {
      clearInterval(tick);
      events.forEach((ev) => window.removeEventListener(ev, handler));
    };
  }, [currentView, showPay, promoCard.show, resetIdle, handleLogout]);

  useEffect(() => {
    if (currentView === "Coupon" && !showPay) {
      requestAnimationFrame(() => couponRef.current?.focus({ preventScroll: true }));
    }
  }, [currentView, showPay]);

  useEffect(() => () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); }, []);

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
            fetch(`${PRINT_BASE}/play/cash.wav`);
            showNotice("ชำระเงินสำเร็จ", "success", false, 3000);
            if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
            setCurrentView("photobooth");
            resetPayUi();
            stop = true;
          } else if (["canceled", "requires_payment_method"].includes(d.status)) {
            fetch(`${PRINT_BASE}/play/i.wav`);
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
  }, [piId]);

 return (
  <WarpBackground className="h-screen flex flex-col" {...WARP_CONFIG}>
    {currentView !== "photobooth" && (
      <div className="text-center pt-8">
        <GradientText
          className="text-4xl font-bold text-center"
          text="Pcc-Photohub"
          neon
          gradient="linear-gradient(90deg, #00ff00 0%, #00ffff 25%, #ff00ff 50%, #00ffff 75%, #00ff00 100%)"
        />
      </div>
    )}

    {/* Toast */}
    {notice && (
      <div className={`fixed top-5 right-5 z-50 transition-opacity duration-700 ${noticeVisible ? "opacity-100" : "opacity-0"}`}>
        <div
          className={`min-w-[260px] max-w-[360px] rounded-xl shadow-xl border backdrop-blur px-4 py-3
            ${cardColor} text-sm font-medium tracking-tight text-gray-900 dark:text-gray-100`}
        >
          <div
            className={`h-1 w-full rounded-full bg-gradient-to-r ${colorBar} mb-2`}
            style={{ width: `${progress}%`, transition: `width ${PROG_TICK}ms linear` }}
          />
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
          {notice.sticky && downList.length > 0 && (
            <div className="mt-1 text-xs opacity-80">{downList.join(" • ")}</div>
          )}
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

    {/* Idle countdown banner */}
    {typeof secondsLeft === "number" && secondsLeft > 0 && secondsLeft <= 20 && (
      <div className="fixed bottom-4 inset-x-0 flex justify-center pointer-events-none">
        <div className="pointer-events-auto px-4 py-2 rounded-full bg-black/70 text-red-500 text-sm shadow-lg backdrop-blur">
          ไม่มีการใช้งาน — จะออกจากระบบอัตโนมัติใน <span className="font-bold">{secondsLeft}</span>
        </div>
      </div>
    )}

    {/* การ์ดโปรโมชัน */}
    {promoCard.show && (
      <PromotionSuccessCard
        amount={promoCard.amount}
        isFree={promoCard.isFree}
        seconds={2}
        playSoundUrl={`${PRINT_BASE}/play/couponuse.wav`}
        onDone={() => {
          setPromoCard((p) => ({ ...p, show: false }));
          if (promoCard.isFree) {
            showNotice("🔖 Free Session", "success", false, 2600);
            setCurrentView("photobooth");
            resetPayUi();
          } else {
            if (piId && payStatus === "requires_action") {
              setShowPay(true);
              if (!countdownRef.current) {
                setTimeLeft(EXPIRE_SECONDS);
                countdownRef.current = setInterval(() => {
                  setTimeLeft((t) => {
                    if (t <= 1) {
                      clearInterval(countdownRef.current);
                      countdownRef.current = null;
                      expireSessionNow();
                      return 0;
                    }
                    return t - 1;
                  });
                }, 1000);
              }
            }
          }
        }}
      />
    )}

    {/* โหมดถ่ายรูป */}
    {currentView === "photobooth" ? (
      <div className="fixed inset-0 z-[50]">
        <PhotoboothInterface user={user} onLogout={handleLogout} />
      </div>
    ) : (
      <div className="flex-1 flex justify-center mt-10 px-6">{renderCurrentView()}</div>
    )}

    <ForgotPinDialog
      open={forgotOpen}
      onOpenChange={setForgotOpen}
      phone={forgotPhone}
      afterReset={() => {
        setCurrentView("login");
        setWrongCount(0);
        showNotice("โปรดใช้ PIN ใหม่ในการเข้าสู่ระบบ", "success", false, 3000);
      }}
    />
  </WarpBackground>
);
}