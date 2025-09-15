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

const WARP_CONFIG = { perspective: 150, beamsPerSide: 4, beamSize: 5, beamDuration: 1 };

const MONGO_BASE = process.env.NEXT_PUBLIC_MONGO_BASE || "";
const NC_BASE    = process.env.NEXT_PUBLIC_NC_BASE || "";
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

  // ---------- Monitor API ----------
  const [isOffline, setIsOffline] = useState(false);
  const [downList, setDownList] = useState([]);
  useEffect(() => {
    let mounted = true;
    let intervalId;
    const checkApis = async () => {
      setProgress(100);
      const bad = [];
      const okMongo = await ping(MONGO_BASE); if (!okMongo) bad.push("DATABASE");
      const okNc    = await ping(NC_BASE);    if (!okNc) bad.push("CLOUD");
      const okCam   = await ping(CAMERA_BASE, "/", 2500); if (!okCam) bad.push("CAMERA");
      if (!mounted) return;
      if (bad.length > 0) { setIsOffline(true); setDownList(bad); showNotice(`Cannot reach: ${bad.join(", ")}`, "warn", true); }
      else { if (isOffline) { setIsOffline(false); setDownList([]); clearNotice(); showNotice("Back online", "success", false, 3000); } }
    };
    checkApis();
    intervalId = setInterval(checkApis, RETRY_MS);
    return () => { mounted = false; if (intervalId) clearInterval(intervalId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [MONGO_BASE, NC_BASE, CAMERA_BASE, isOffline]);

  // ---------- Actions ----------
  const handleStartClick = () => setCurrentView("login");
  const handleBackToStart = () => setCurrentView("start");

  const handleLogin = async ({ phone, pin }) => {
    setBusy(true);
    try {
      let existed = true;
      try { await client.getUserByNumber(phone); } // มี user ไหม
      catch (e) { if (e?.status === 404) existed = false; else throw e; }

      // ล็อกอิน/สมัคร + ตรวจ PIN
      await client.ensureUserAndPin({ number: phone, pin }); // ถ้า PIN ผิดจะ 401
      if (typeof window !== "undefined") {
        localStorage.setItem("pcc_user_phone", phone);
        localStorage.setItem("pcc_user_pin", pin);
      }
      setUser({ phone });
      setCurrentView("photobooth");
      showNotice(existed ? "Signed in" : "New user created", "success", false, 4000);
      setWrongCount(0);
    } catch (e) {
      if (!e?.status && (e?.name === "TypeError" || /Failed to fetch|NetworkError|fetch/i.test(e?.message || ""))) {
        showNotice("API unreachable. Please check connection.", "warn", true);
      } else if (e?.status === 401) {
        showNotice("Wrong PIN", "error", false, 4000);
        setWrongCount((c) => {
          const next = c + 1;
          if (next >= 3) {
            setForgotPhone(phone);
            setForgotOpen(true); // เด้ง popup ลืม PIN
          }
          return next;
        });
      } else if (e?.status >= 500) {
        showNotice("Server error: DATABASE", "error", true);
      } else {
        showNotice(`Login failed: ${e?.message || "REQUEST_FAILED"}`, "warn", false, 5000);
      }
    } finally { setBusy(false); }
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentView("start");
    if (typeof window !== "undefined") {
      localStorage.removeItem("pcc_user_phone");
      localStorage.removeItem("pcc_user_pin");
    }
    showNotice("Signed out", "success", false, 3000);
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case "login":
        return (
          <PhoneLoginCard
            onBack={handleBackToStart}
            onLogin={busy ? () => {} : handleLogin}
            onForgotPin={(phone) => { setForgotPhone(phone); setForgotOpen(true); }} // ปุ่ม "ลืม PIN ?"
          />
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
    notice?.variant === "success" ? "from-emerald-400 to-lime-400" :
    notice?.variant === "error"   ? "from-rose-400 to-red-500" : "from-amber-400 to-yellow-400";
  const cardColor =
    notice?.variant === "success" ? "bg-white/85 dark:bg-gray-900/85 border-emerald-300/60" :
    notice?.variant === "error"   ? "bg-white/85 dark:bg-gray-900/85 border-rose-300/60" :
                                    "bg-white/85 dark:bg-gray-900/85 border-amber-300/60";

  const retryNow = async () => {
    setProgress(100);
    const bad = [];
    const okMongo = await ping(MONGO_BASE); if (!okMongo) bad.push("DATABASE");
    const okNc    = await ping(NC_BASE);    if (!okNc) bad.push("CLOUD");
    if (bad.length > 0) { setIsOffline(true); setDownList(bad); showNotice(`Cannot reach: ${bad.join(", ")}`, "warn", true); }
    else { setIsOffline(false); setDownList([]); clearNotice(); showNotice("Back online", "success", false, 3000); }
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
          <div className={`min-w-[260px] max-w-[320px] rounded-xl shadow-xl border backdrop-blur px-4 py-3 ${cardColor}
                           text-sm font-medium tracking-tight text-gray-900 dark:text-gray-100`}>
            <div className={`h-1 w-full rounded-full bg-gradient-to-r ${colorBar} mb-2`}
                 style={{ width: `${progress}%`, transition: `width ${PROG_TICK}ms linear` }} />
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
              <div className="mt-1 text-xs opacity-80">{downList.join(" • ")}</div>
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
          showNotice("โปรดใช้ PIN ใหม่ในการเข้าสู่ระบบ", "success", false, 3000);
        }}
      />
    </WarpBackground>
  );
}
