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
import { useSession, signIn, signOut } from "next-auth/react";

const WARP_CONFIG = {
  perspective: 150,
  beamsPerSide: 4,
  beamSize: 5,
  beamDuration: 1,
};

const MONGO_BASE = process.env.NEXT_PUBLIC_MONGO_BASE || "";
const NC_BASE = process.env.NEXT_PUBLIC_NC_BASE || "";
const CAMERA_BASE = process.env.NEXT_PUBLIC_CAMERA_BASE || "";

const RETRY_MS = 30000;
const PROG_TICK = 100;
const PROG_STEP = 100 / (RETRY_MS / PROG_TICK);

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
      await fetch(base, {
        method: "GET",
        signal: ac.signal,
        cache: "no-store",
      });
      return true;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(id);
  }
}

export default function BoothPage() {
  const { data: session } = useSession();
  const [currentView, setCurrentView] = useState("start"); // "start" | "login" | "photobooth"
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);

  // ----- forgot-pin states -----
  const [wrongCount, setWrongCount] = useState(0);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotPhone, setForgotPhone] = useState("");

  // ---------- Toast ----------
  const [notice, setNotice] = useState(null); // { text, variant, sticky }
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const hideTimerRef = useRef(null);
  const removeTimerRef = useRef(null);
  const progressTimerRef = useRef(null);
  // ----------Promo + payment state --------
  const [promos, setPromos] = useState([]);
  const [selectedPromo, setSelectedPromo] = useState(null);
  const [qrUrl, setQrUrl] = useState("");
  const [piId, setPiId] = useState("");
  const [payStatus, setPayStatus] = useState(""); // 'requires_payment_method' | 'processing' | 'succeeded' etc.
  const [loadingPay, setLoadingPay] = useState(false);
  const BASE_ORDER_AMOUNT = 50;

  useEffect(() => {
    (async () => {
      try {
        const result = await client.listPromos({ active: true });
        setPromos(
          Array.isArray(result.data) ? result.data : result.data?.promos || []
        );
      } catch (e) {
        console.error("Fetch promos failed:", e.message);
      }
    })();
  }, []);

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
      hideTimerRef.current = setTimeout(
        () => setNoticeVisible(false),
        duration
      );
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
  useEffect(() => () => clearTimers(), []);

  // ---------- Monitor API ----------
  const [isOffline, setIsOffline] = useState(false);
  const [downList, setDownList] = useState([]);
  useEffect(() => {
    let mounted = true;
    let intervalId;
    const checkApis = async () => {
      setProgress(100);
      const bad = [];
      const okMongo = await ping(MONGO_BASE);
      if (!okMongo) bad.push("DATABASE");
      const okNc = await ping(NC_BASE);
      if (!okNc) bad.push("CLOUD");
      const okCam = await ping(CAMERA_BASE, "/", 2500);
      if (!okCam) bad.push("CAMERA");
      if (!mounted) return;
      if (bad.length > 0) {
        setIsOffline(true);
        setDownList(bad);
        showNotice(`Cannot reach: ${bad.join(", ")}`, "warn", true);
      } else {
        if (isOffline) {
          setIsOffline(false);
          setDownList([]);
          clearNotice();
          showNotice("Back online", "success", false, 3000);
        }
      }
    };
    checkApis();
    intervalId = setInterval(checkApis, RETRY_MS);
    return () => {
      mounted = false;
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [MONGO_BASE, NC_BASE, CAMERA_BASE, isOffline]);

  // ---------- Actions ----------
  const handleStartClick = () => setCurrentView("login");
  const handleBackToStart = () => setCurrentView("start");

  const handleLogin = async ({ phone, pin }) => {
    setBusy(true);
    try {
      const result = await signIn("credentials", {
        redirect: false,
        phone,
        pin,
      });

      if (result?.error) {
        showNotice(`Login failed: ${result.error}`, "warn", false, 5000);
        return;
      }

      setUser({ phone });
      setCurrentView("Coupon");
      showNotice("Signed in", "success", false, 4000);
      setWrongCount(0);
    } catch (e) {
      showNotice(
        `Login failed: ${e.message || "REQUEST_FAILED"}`,
        "warn",
        false,
        5000
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await signOut({ redirect: false });
    setUser(null);
    setCurrentView("start");
    showNotice("Signed out", "success", false, 3000);
  };

  const handleSelectPromo = async (promo) => {
    try {
      const orderAmount = BASE_ORDER_AMOUNT;
      const res = await client.validatePromo(promo.code, {
        userNumber: user?.phone,
        orderAmount,
      });
      console.log("Validated promo:", res);
      setSelectedPromo(promo);
    } catch (e) {
      console.error("Promo not valid:", e.message);
    }
  };
  const handleRedeemPromo = async () => {
    if (!selectedPromo) return;
    try {
      const res = await client.redeemPromo(selectedPromo.code, {
        userNumber: user?.phone,
        orderAmount: BASE_ORDER_AMOUNT,
      });
      console.log("Promo redeemed:", res);
    } catch (e) {
      console.error("Redeem failed:", e.message);
    }
  };
  const startPayment = async (promo) => {
    setLoadingPay(true);
    setSelectedPromo(promo);
    setQrUrl("");
    setPiId("");
    setPayStatus("");
    try {
      const r = await fetch("/api/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promoCode: promo.code,
          userNumber: user?.phone, // you already set user { phone } on login:contentReference[oaicite:2]{index=2}
          orderAmount: BASE_ORDER_AMOUNT, // THB amount before discount
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok)
        throw new Error(data.message || "PAY_CREATE_FAILED");
      setQrUrl(data.qr);
      setPiId(data.paymentIntentId);
      setPayStatus("requires_payment_method");
    } catch (e) {
      console.error("Create pay failed:", e.message);
    } finally {
      setLoadingPay(false);
    }
  };
  useEffect(() => {
    if (!piId) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/pay/${piId}`);
        const d = await r.json();
        if (d.ok) {
          setPayStatus(d.status);
          if (
            d.status === "succeeded" ||
            d.status === "canceled" ||
            d.status === "requires_payment_method"
          ) {
            // stop polling on terminal states except "processing"
            if (d.status !== "processing") stop = true;
          }
        }
      } catch {}
      if (!stop) setTimeout(tick, 2500);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [piId]);

  const renderCurrentView = () => {
    switch (currentView) {
      case "login":
        return (
          <PhoneLoginCard
            onBack={handleBackToStart}
            onLogin={busy ? () => {} : handleLogin}
            onForgotPin={(phone) => {
              setForgotPhone(phone);
              setForgotOpen(true);
            }}
          />
        );
      case "Coupon":
        return (
          <div className="flex flex-col items-center gap-4 w-full max-w-[720px]">
            Logged in as: {session?.user?.name || "Unknown"}
            <div className="w-full">
              {promos.map((p) => (
                <PromotionCard
                  key={p.code}
                  couponCode={p.code}
                  details={{
                    type: p.type,
                    value: p.value,
                    startAt: p.start_at,
                    endAt: p.end_at,
                    usageLimit: p.usage_limit,
                    usedCount: p.used_count,
                    perUserLimit: p.per_user_limit,
                  }}
                  onRedeem={() => startPayment(p)}
                />
              ))}
            </div>
            {/* Stripe PromptPay QR shows here when user clicked a promo */}
            {loadingPay && (
              <p className="text-sm opacity-70">Creating payment…</p>
            )}
            {qrUrl && (
              <div className="mt-4 p-4 rounded-xl border bg-white/80 dark:bg-gray-900/50">
                <p className="text-sm font-medium mb-2 text-center">
                  Scan with a Thai banking app (PromptPay)
                </p>
                <img
                  src={qrUrl}
                  alt="PromptPay QR"
                  className="w-56 h-56 mx-auto"
                />
                <div className="text-xs text-center mt-2 opacity-70">
                  Status: {payStatus || "—"}
                </div>
              </div>
            )}
          </div>
        );

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
    notice?.variant === "success"
      ? "from-emerald-400 to-lime-400"
      : notice?.variant === "error"
      ? "from-rose-400 to-red-500"
      : "from-amber-400 to-yellow-400";
  const cardColor =
    notice?.variant === "success"
      ? "bg-white/85 dark:bg-gray-900/85 border-emerald-300/60"
      : notice?.variant === "error"
      ? "bg-white/85 dark:bg-gray-900/85 border-rose-300/60"
      : "bg-white/85 dark:bg-gray-900/85 border-amber-300/60";

  const retryNow = async () => {
    setProgress(100);
    const bad = [];
    const okMongo = await ping(MONGO_BASE);
    if (!okMongo) bad.push("DATABASE");
    const okNc = await ping(NC_BASE);
    if (!okNc) bad.push("CLOUD");
    if (bad.length > 0) {
      setIsOffline(true);
      setDownList(bad);
      showNotice(`Cannot reach: ${bad.join(", ")}`, "warn", true);
    } else {
      setIsOffline(false);
      setDownList([]);
      clearNotice();
      showNotice("Back online", "success", false, 3000);
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
        <div
          className={`fixed top-5 right-5 z-50 transition-opacity duration-700 ${
            noticeVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            className={`min-w-[260px] max-w-[320px] rounded-xl shadow-xl border backdrop-blur px-4 py-3 ${cardColor}
                           text-sm font-medium tracking-tight text-gray-900 dark:text-gray-100`}
          >
            <div
              className={`h-1 w-full rounded-full bg-gradient-to-r ${colorBar} mb-2`}
              style={{
                width: `${progress}%`,
                transition: `width ${PROG_TICK}ms linear`,
              }}
            />
            <div className="flex items-center justify-between gap-3">
              <span>{notice.text}</span>
              {notice.variant === "warn" && (
                <button
                  onClick={retryNow}
                  className="ml-2 px-2 py-1 text-xs rounded-md border border-amber-400/60
                             bg-amber-50/60 dark:bg-amber-900/20 hover:bg-amber-100/70
                             dark:hover:bg-amber-900/30 transition"
                >
                  Retry
                </button>
              )}
            </div>
            {notice.sticky && downList.length > 0 && (
              <div className="mt-1 text-xs opacity-80">
                {downList.join(" • ")}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex justify-center mt-10 px-10">
        {renderCurrentView()}
      </div>

      {/* Forgot PIN Popup */}
      <ForgotPinDialog
        open={forgotOpen}
        onOpenChange={setForgotOpen}
        phone={forgotPhone}
        afterReset={() => {
          setCurrentView("login");
          setWrongCount(0);
          showNotice(
            "โปรดใช้ PIN ใหม่ในการเข้าสู่ระบบ",
            "success",
            false,
            3000
          );
        }}
      />
    </WarpBackground>
  );
}
