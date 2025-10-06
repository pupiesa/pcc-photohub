// components/PhotoboothInterface.js
"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { client } from "@/lib/photoboothClient";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader } from "@/components/ui/shadcn-io/ai/loader";
import { GradientText } from "@/components/ui/shadcn-io/gradient-text";
import { toast } from "sonner";

const TEMPLATE_KEY = "kmitl2025";
const CAMERA_BASE =
  (process.env.NEXT_PUBLIC_CAMERA_BASE || "").replace(/\/$/, "") || null;
const MAX_PHOTOS = 2;

const PRINT_HOST = process.env.PRINT_API_HOST || "127.0.0.1";
const PRINT_PORT = process.env.PRINT_API_PORT || "5000";
const PRINT_BASE = `http://${PRINT_HOST}:${PRINT_PORT}`;

export default function PhotoboothInterface({ user, onLogout }) {
  const router = useRouter();
  const pathname = usePathname();

  const [countdown, setCountdown] = useState(null);
  const [shooting, setShooting] = useState(false);
  const [preMessage, setPreMessage] = useState(false); // ✅ Overlay ก่อนนับ
  const [photosTaken, setPhotosTaken] = useState(0);
  const [capturedImage, setCapturedImage] = useState(null);
  const [capturedServerPath, setCapturedServerPath] = useState(null);
  const [sessionPaths, setSessionPaths] = useState([]);
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  // ดีเลย์ปุ่ม 2.5 วิ หลังถ่ายเสร็จ
  const [buttonsReady, setButtonsReady] = useState(false);
  useEffect(() => {
    if (capturedImage) {
      setButtonsReady(false);
      const t = setTimeout(() => setButtonsReady(true), 2500);
      return () => clearTimeout(t);
    }
    setButtonsReady(false);
  }, [capturedImage]);

  // live preview
  const [liveSrc, setLiveSrc] = useState(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const liveImgRef = useRef(null);

  // โหมดแสดงผลภาพ: cover = เต็มจอ (อาจครอป), contain = ทั้งภาพ (อาจมีขอบ)
  const [fitMode, setFitMode] = useState("cover"); // "cover" | "contain"
  const objectClass = useMemo(
    () => (fitMode === "cover" ? "object-cover" : "object-contain"),
    [fitMode]
  );

  const stopCamera = async () => {
    if (!CAMERA_BASE) return;
    try {
      await Promise.any([
        fetch(`${CAMERA_BASE}/stop_stream`, { method: "POST" }),
        fetch(`${CAMERA_BASE}/stop`, { method: "POST" }),
      ]);
    } catch {}
  };

  useEffect(() => {
    if (!CAMERA_BASE || pathname !== "/booth") return;
    setLiveLoading(true);
    setLiveSrc(`${CAMERA_BASE}/video_feed?ts=${Date.now()}`);
    return () => {
      if (liveImgRef.current) liveImgRef.current.removeAttribute("src");
      setLiveSrc(null);
      setLiveLoading(true);
      stopCamera();
    };
  }, [pathname]);

  // เริ่มถ่าย: โชว์ overlay 4 วินาที → ค่อยเริ่มนับ 3-2-1
  const startPhotoshoot = () => {
    setShooting(true);
    setPreMessage(true);

    setTimeout(() => {
      setPreMessage(false);
      fetch(`${PRINT_BASE}/play/321.wav`).catch(() => {});
      let count = 3;
      setCountdown(count);
      const timer = setInterval(() => {
        count--;
        if (count > 0) setCountdown(count);
        else {
          setCountdown("📸");
          setTimeout(() => {
            setCountdown(null);
            handleCapture();
          }, 500);
          clearInterval(timer);
        }
      }, 1000);
    }, 2800); // เตือน 2.8 วินาที
  };

  const handleCapture = async () => {
    try {
      if (!CAMERA_BASE) throw new Error("CAMERA_BASE not set");
      fetch(`${PRINT_BASE}/play/che.wav`).catch(() => {});
      const res = await fetch(`${CAMERA_BASE}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok)
        throw new Error((await res.text()) || `Capture failed: ${res.status}`);
      const data = await res.json();
      const url = data?.url;
      if (!url) throw new Error("No image url returned");
      setCapturedImage(`${CAMERA_BASE}${url}?ts=${Date.now()}`);
      setCapturedServerPath(data?.serverPath || null);
    } catch (err) {
      toast.error("การเชื่อมต่อผิดพลาด ถ่ายภาพไม่สำเร็จ");
    } finally {
      setShooting(false);
    }
  };

  const uploadBatchAndGo = async (paths) => {
    const number = user?.phone || user?.number;
    if (!number || !paths.length) return;

    const remotes = [];
    const up1 = await client.uploadAndShare({
      folderName: number,
      filePath: paths[0],
    });
    if (up1?.share?.url) await client.setNextcloudLink(number, up1.share.url);
    if (up1?.uploaded?.remotePath) remotes.push(up1.uploaded.remotePath);

    for (let i = 1; i < paths.length; i++) {
      const r = await client.uploadOnly({
        folderName: number,
        filePath: paths[i],
      });
      if (r?.uploaded?.remotePath) remotes.push(r.uploaded.remotePath);
    }
    if (remotes.length) await client.appendFileAddress(number, remotes);

    if (liveImgRef.current) liveImgRef.current.removeAttribute("src");
    setLiveSrc(null);
    await stopCamera().catch(() => {});

    setRedirecting(true);
    router.push("/dashboard");
  };

  const handleConfirmCapture = async () => {
    try {
      setBusy(true);
      const nextPaths = capturedServerPath ? [...sessionPaths, capturedServerPath] : [...sessionPaths];
      const nextCount = photosTaken + 1;

      setCapturedImage(null);
      setCapturedServerPath(null);
      setSessionPaths(nextPaths);
      setPhotosTaken(nextCount);

      if (nextCount >= MAX_PHOTOS) {
        if (liveImgRef.current) liveImgRef.current.removeAttribute("src");
        setLiveSrc(null);
        await stopCamera().catch(() => {});
        await uploadBatchAndGo(nextPaths);

        // สั่งพิมพ์
        try {
          const apiRes = await fetch(`${PRINT_BASE}/print`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              paths: nextPaths,
              templateKey: TEMPLATE_KEY,
            }),
          });
          if (apiRes.ok) {
            fetch(`${PRINT_BASE}/play/print.wav`).catch(() => {});
          } else {
            console.error("Print API call failed:", await apiRes.text());
          }
        } catch (err) {
          console.error("Error call Print API:", err);
        }
        return;
      }

      if (CAMERA_BASE) {
        const r = await fetch(`${CAMERA_BASE}/confirm`, {
          method: "POST",
        }).catch(() => null);
        let nextLive = `${CAMERA_BASE}/video_feed?ts=${Date.now()}`;
        if (r && r.ok) {
          const data = await r.json().catch(() => ({}));
          if (data?.video) nextLive = `${CAMERA_BASE}${data.video}`;
        }
        setLiveLoading(true);
        setLiveSrc(nextLive);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRetake = async () => {
    try {
     setBusy(true);
      setCapturedImage(null);
      setCapturedServerPath(null);
      setCountdown(null);

      if (CAMERA_BASE) {
       const r = await fetch(`${CAMERA_BASE}/confirm`, { method: "POST" }).catch(() => null);
        let nextLive = `${CAMERA_BASE}/video_feed?ts=${Date.now()}`;
        if (r && r.ok) {
          try {
            const data = await r.json();
            if (data?.video) nextLive = `${CAMERA_BASE}${data.video}`;
          } catch { /* /return_live จะไม่เป็น JSON ก็ไม่เป็นไร */ }
        }
        setLiveSrc(nextLive);
        // บังคับโหลดใหม่
        if (liveImgRef.current) liveImgRef.current.src = nextLive;
      }
    } finally {
      setLiveLoading(true);
      setBusy(false);
    }
  };

  // ซ่อน UI ตอนกำลังนับ/ลั่นชัตเตอร์
  const hideUi = shooting && !capturedImage;

  return (
    <div className="fixed inset-0 z-20 bg-black">
      {/* ชั้นภาพ (เต็มจอ) */}
      <div className="absolute inset-0">
        {!capturedImage && (liveLoading || !liveSrc) && (
          <div className="absolute inset-0 grid place-items-center text-white/90">
            <div className="flex flex-col items-center gap-3">
              <Loader />
              <div className="text-sm opacity-80">Starting live preview…</div>
            </div>
          </div>
        )}

        {!capturedImage ? (
          liveSrc ? (
            <img
              ref={liveImgRef}
              src={liveSrc ?? undefined}
              alt="Live preview"
              className={`w-full h-full ${objectClass} select-none`}
              onLoad={() => setLiveLoading(false)}
              onError={() => setLiveLoading(false)}
              draggable={false}
            />
          ) : null
        ) : (
          <img
            src={capturedImage}
            alt="Captured"
            className={`w-full h-full ${objectClass} select-none`}
            draggable={false}
          />
        )}
      </div>

      {/* ==========  Overlay ชี้ตำแหน่งกล้อง  ========== */}
      {preMessage && !capturedImage && (
        <div className="absolute inset-0 z-30 overflow-hidden flex items-center justify-center">
          {/* พื้นหลังมินิมอล + vignette เบา ๆ */}
          <div className="absolute inset-0 bg-neutral-950/85" />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(60% 50% at 50% 40%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 60%)",
            }}
          />

          {/* เนื้อหา */}
          <div className="relative z-10 text-center px-6 font-sans tracking-tight">
            {/* หัวข้อ  */}
            <h1
              className="mx-auto font-semibold text-white animate-zoomIn"
              style={{ fontSize: "clamp(28px, 6.6vw, 64px)", lineHeight: 1.1 }}
            >
              กรุณามองกล้องด้านบน
            </h1>

            {/* บรรทัดรอง — สีขาวโปร่ง */}
            <p
              className="mt-3 mx-auto text-white/80 animate-fadeInSlow"
              style={{ fontSize: "clamp(14px, 2.2vw, 20px)" }}
            >
              นิ่งไว้สักครู่ เพื่อภาพที่คมชัดและเป็นธรรมชาติ
            </p>

           {/* ลูกศร SVG */}
          <div className="mt-8 flex justify-center animate-bounceArrow">
            <svg
              width="108"
              height="156"
              viewBox="0 0 108 156"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <defs>
                {/* เส้นไล่สีบนก้าน แอนิเมชันเลื่อนขึ้น */}
                <linearGradient id="arrowStroke" x1="0" y1="156" x2="0" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0%"  stopColor="rgba(255,255,255,0.85)"/>
                  <stop offset="55%" stopColor="rgba(255,255,255,1)"/>
                  <stop offset="100%" stopColor="rgba(255,255,255,0.85)"/>
                  <animateTransform
                    attributeName="gradientTransform"
                    type="translate"
                    from="0 0" to="0 -24"
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                </linearGradient>

                {/* glow รอบลูกศร */}
                <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
                  <feMerge>
                    <feMergeNode in="blur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>

                {/* ไฮไลต์บาง ๆ บนขอบ */}
                <linearGradient id="edgeHighlight" x1="0" y1="156" x2="0" y2="0">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.12)"/>
                  <stop offset="100%" stopColor="rgba(255,255,255,0.28)"/>
                </linearGradient>
              </defs>

              {/* ก้านลูกศร */}
              <path
                d="M54 140 L54 44"
                stroke="url(#arrowStroke)"
                strokeWidth="10"
                strokeLinecap="round"
                filter="url(#softGlow)"
              />

              {/* หัวลูกศร */}
              <path
                d="M54 18 L31 50 L77 50 Z"
                fill="white"
                filter="url(#softGlow)"
              />

              {/* ขอบไฮไลต์บาง ๆ */}
              <path
                d="M54 140 L54 44"
                stroke="url(#edgeHighlight)"
                strokeWidth="12"
                strokeLinecap="round"
                style={{ opacity: 0.35, filter: "blur(6px)" }}
              />

              {/* จุดประกายเล็ก */}
              <circle cx="54" cy="26" r="2.5" fill="white" opacity="0.9">
                <animate attributeName="r" values="2;4;2" dur="1.8s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.8s" repeatCount="indefinite"/>
              </circle>
            </svg>
          </div>

            {/* ป้ายบอกตำแหน่ง  */}
            <div className="mt-4 inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-white/90 text-sm">
              กล้องอยู่ด้านบนของหน้าจอ
            </div>
          </div>

          {/* เส้นแสงขอบล่าง */}
          <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden">
            <div
              className="w-[200%] h-full animate-lightScan"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(255,255,255,.22) 15%, rgba(255,255,255,.55) 30%, rgba(255,255,255,.22) 45%, transparent 60%)",
              }}
            />
          </div>
        </div>
      )}

      {/* นับถอยหลังกึ่งกลางจอ  */}
      {countdown && !capturedImage && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-white drop-shadow-[0_2px_10px_rgba(0,0,0,.7)] text-[20vw] leading-none font-bold select-none animate-zoomIn">
            {countdown}
          </div>
        </div>
      )}

      {/* แถบควบคุมบน (ซ้าย: Logout / ขวา: Fill/Contain) */}
      <div
        className={`absolute top-4 left-4 right-4 flex items-center justify-between transition-all duration-200 ${
          hideUi ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
      >
        <Button
          onClick={onLogout}
          className="bg-rose-500/80 hover:bg-rose-500/90 text-white border border-rose-300/50 backdrop-blur-xl  shadow-lg shadow-cyan-500/50"
          disabled={busy || redirecting || hideUi}
        >
          Logout
        </Button>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-full backdrop-blur-xl bg-black/40 text-white text-xs border border-white/20 shadow">
            <GradientText
              className="text-sm text-gray-500 mt-1"
              text={`Photos: ${photosTaken}/${MAX_PHOTOS}`}
              neon
              gradient="linear-gradient(90deg, #fecaca 0%, #fda4af 28%, #f9a8d4 62%, #c4b5fd 100%)"
            />
          </div>
          <Button
            variant="outline"
            onClick={() =>
              setFitMode((m) => (m === "cover" ? "contain" : "cover"))
            }
            className="backdrop-blur-md bg-white/10 text-white border-white/30 hover:bg-white/20"
            disabled={hideUi}
          >
            {fitMode === "cover" ? "Fill" : "Contain"}
          </Button>
        </div>
      </div>

      {/* แถบปุ่มกึ่งกลางด้านล่าง — ❗คงสี/เงาเดิม */}
      <div
        className={`absolute inset-x-0 bottom-6 flex justify-center px-4 transition-all duration-200 ${
          hideUi
            ? "opacity-0 pointer-events-none translate-y-2"
            : "opacity-100 translate-y-0"
        }`}
      >
        <div className="w-full max-w-[720px] rounded-2xl border border-white/15 bg-black/35 backdrop-blur-2xl shadow-[0_10px_40px_rgba(0,0,0,.45)] p-3">
          {!capturedImage ? (
            <div className="flex items-center justify-center gap-3">
              {photosTaken < MAX_PHOTOS ? (
                <Button
                  onClick={startPhotoshoot}
                  className="h-16 px-8 text-xl font-bold rounded-xl bg-white text-gray-900 hover:bg-gray-50 shadow-lg"
                  disabled={!CAMERA_BASE || busy || redirecting || hideUi}
                >
                  Take Photo {photosTaken + 1}
                </Button>
              ) : (
                <div className="text-white/80 text-sm">Processing…</div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3">
              <Button
                onClick={handleRetake}
                variant="outline"
                className={`h-14 px-6 text-base md:text-lg rounded-xl border-white/40 text-white bg-white/10 hover:bg-white/20 ${
                  buttonsReady
                    ? "ring-2 ring-rose-500/80 shadow-lg shadow-rose-500 md:shadow-xl md:shadow-rose-500"
                    : "opacity-50 cursor-not-allowed"
                }`}
                disabled={busy || redirecting || !buttonsReady}
              >
                Retake
              </Button>
              <Button
                onClick={handleConfirmCapture}
                className={`h-14 px-8 text-base md:text-lg font-semibold rounded-xl shadow-lg ${
                  buttonsReady
                    ? "bg-white text-gray-900 hover:bg-gray-50 ring-4 ring-cyan-500/50 shadow-lg shadow-cyan-500 md:shadow-xl md:shadow-cyan-500"
                    : "bg-gray-300 text-gray-600 cursor-not-allowed"
                }`}
                disabled={busy || redirecting || !buttonsReady}
              >
                {busy ? "Processing…" : "Confirm"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Overlay shadcn Dialog */}
      <Dialog open={photosTaken >= MAX_PHOTOS && !redirecting}>
        <DialogContent>
          <DialogHeader className="text-center">
            <div className="text-6xl mb-2">✅</div>
            <DialogTitle>Session Complete!</DialogTitle>
            <DialogDescription>
              {redirecting ? "Redirecting…" : "Processing your photos..."}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex justify-center">
            <Loader />
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== Keyframes / Utilities – ใช้กับ Overlay เท่านั้น ===== */}
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; } to { opacity: 1; }
        }
        @keyframes fadeInSlow {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes zoomIn {
          0% { opacity: 0; transform: scale(0.98); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes bounceArrow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes lightScan {
          0% { transform: translateX(-25%); }
          100% { transform: translateX(0%); }
        }
        .animate-fadeIn { animation: fadeIn 220ms ease-out both; }
        .animate-fadeInSlow { animation: fadeInSlow 420ms ease-out 80ms both; }
        .animate-zoomIn { animation: zoomIn 260ms ease-out both; }
        .animate-bounceArrow { animation: bounceArrow 1.1s ease-in-out infinite; }
        .animate-lightScan { animation: lightScan 2.2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
