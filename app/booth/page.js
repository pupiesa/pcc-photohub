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
  // notice = { text: string, variant: "success" | "error" | "warn" }
  const [notice, setNotice] = useState(null);
  const [noticeVisible, setNoticeVisible] = useState(false); // คุม fade-in/out
  const hideTimerRef = useRef(null);
  const removeTimerRef = useRef(null);

  // ใช้แทน setNotice: โชว์ 5 วิ แล้วค่อยๆ จางหาย
  const showNotice = (text, variant = "success", ms = 5000) => {
    // เคลียร์ timer เดิมก่อน
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (removeTimerRef.current) clearTimeout(removeTimerRef.current);

    setNotice({ text, variant });
    setNoticeVisible(true);                 // fade-in

    // เริ่ม fade-out หลังครบ ms
    hideTimerRef.current = setTimeout(() => setNoticeVisible(false), ms);
    // รอ transition (0.7s) แล้วค่อยลบออกจาก DOM
    removeTimerRef.current = setTimeout(() => setNotice(null), ms + 700);
  };

  // ล้าง timer ตอน unmount
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
    };
  }, []);

  // ---------- Navigation handlers ----------
  const handleStartClick = () => setCurrentView("login");
  const handleBackToStart = () => setCurrentView("start");

  // รับ { phone, pin } จาก PhoneLoginCard (PIN 6 หลัก)
  const handleLogin = async ({ phone, pin }) => {
    setBusy(true);
    try {
      // เช็คก่อนว่ามี user อยู่ไหม
      let existed = true;
      try {
        await client.getUserByNumber(phone);
      } catch (e) {
        if (e?.status === 404) existed = false;
        else throw e;
      }

      // สร้างถ้าไม่มี + เช็ค PIN (จะ throw 401 ถ้า PIN ผิด)
      await client.ensureUserAndPin({ number: phone, pin });

      setUser({ phone });
      setCurrentView("photobooth");
      showNotice(existed ? "✅ เข้าสู่ระบบสำเร็จ" : "✅ สร้างผู้ใช้ใหม่เรียบร้อย", "success");
    } catch (e) {
      if (e?.status === 401) {
        showNotice("❌ รหัสผิด กรุณาลองใหม่", "error");
      } else {
        showNotice(`⚠️ เข้าสู่ระบบไม่สำเร็จ: ${e?.message || "REQUEST_FAILED"}`, "warn");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentView("start");
    showNotice("👋 ออกจากระบบแล้ว", "success");
  };

  // ---------- UI ----------
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

      {/* 🔔 Toastclass fixed/top/right */}
      {notice && (
        <div
          className={`fixed top-4 right-4 z-50 transition-opacity duration-700 ${
            noticeVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            className={[
              "px-4 py-2 rounded-md shadow-lg border text-sm",
              notice.variant === "success" && "bg-emerald-600/90 text-white border-emerald-500",
              notice.variant === "error" && "bg-rose-600/90 text-white border-rose-500",
              notice.variant === "warn" && "bg-amber-600/90 text-white border-amber-500",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {notice.text}
          </div>
        </div>
      )}

      <div className="flex-1 flex justify-center mt-10 px-10">
        {renderCurrentView()}
      </div>
    </WarpBackground>
  );
}
