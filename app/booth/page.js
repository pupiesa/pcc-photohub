"use client";

import { useEffect, useRef, useState } from "react";
import { client } from "@/lib/photoboothClient";
import { WarpBackground } from "@/components/ui/shadcn-io/warp-background";
import { GradientText } from "@/components/ui/shadcn-io/gradient-text";
import StartCard from "@/components/IndexCard";
import PhoneLoginCard from "@/components/PhoneLoginCard";
import PhotoboothInterface from "@/components/PhotoboothInterface";

const WARP_CONFIG = { perspective: 150, beamsPerSide: 4, beamSize: 5, beamDuration: 1 };

export default function BoothPage() {
  const [currentView, setCurrentView] = useState("start"); // "start" | "login" | "photobooth"
  const [user, setUser] = useState(null);                  // { phone }
  const [busy, setBusy] = useState(false);

  // ---------- Toast state ----------
  // notice = { text, variant } ; variant: "success" | "error" | "warn"
  const [notice, setNotice] = useState(null);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [progress, setProgress] = useState(100); // 100 -> 0
  const hideTimerRef = useRef(null);
  const removeTimerRef = useRef(null);
  const progressTimerRef = useRef(null);

  const showNotice = (text, variant = "success", ms = 5000) => {
    // clear timers
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);

    setNotice({ text, variant });
    setNoticeVisible(true);
    setProgress(100);

    // progress countdown
    const step = 100 / (ms / 100); // update every 100ms
    progressTimerRef.current = setInterval(() => {
      setProgress((p) => {
        const next = Math.max(0, p - step);
        return next;
      });
    }, 100);

    hideTimerRef.current = setTimeout(() => setNoticeVisible(false), ms);
    removeTimerRef.current = setTimeout(() => {
      setNotice(null);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    }, ms + 700); // allow fade-out transition
  };

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, []);

  // ---------- Navigation handlers ----------
  const handleStartClick = () => setCurrentView("login");
  const handleBackToStart = () => setCurrentView("start");

  // รับ { phone, pin, mode } จาก PhoneLoginCard
  const handleLogin = async ({ phone, pin }) => {
    setBusy(true);
    try {
      let existed = true;
      try {
        await client.getUserByNumber(phone);
      } catch (e) {
        if (e?.status === 404) existed = false;
        else throw e;
      }

      await client.ensureUserAndPin({ number: phone, pin }); // สร้างถ้าไม่มี + เช็ค PIN

      setUser({ phone });
      setCurrentView("photobooth");
      showNotice(existed ? "Signed in" : "New user created", "success");
    } catch (e) {
      if (e?.status === 401) showNotice("Wrong PIN", "error");
      else showNotice(`Login failed: ${e?.message || "REQUEST_FAILED"}`, "warn");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentView("start");
    showNotice("Signed out", "success");
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case "login":
        return (
          <PhoneLoginCard
            onBack={handleBackToStart}
            onLogin={busy ? () => {} : handleLogin}
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
            className={`min-w-[220px] rounded-xl shadow-xl border backdrop-blur px-4 py-3 ${cardColor}
                        text-sm font-medium tracking-tight text-gray-900 dark:text-gray-100`}
            style={{ fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" }}
          >
            {/* progress bar */}
            <div className={`h-1 w-full rounded-full bg-gradient-to-r ${colorBar} mb-2`}
                 style={{ width: `${progress}%`, transition: "width 100ms linear" }} />
            <div className="flex items-center gap-2">
              <span>
                {notice.text}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex justify-center mt-10 px-10">
        {renderCurrentView()}
      </div>
    </WarpBackground>
  );
}
