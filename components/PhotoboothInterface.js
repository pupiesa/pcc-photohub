// components/PhotoboothInterface.js
"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { client } from "@/lib/photoboothClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader } from "@/components/ui/shadcn-io/ai/loader";
import { GradientText } from "@/components/ui/shadcn-io/gradient-text";
import { toast } from "sonner";

const TEMPLATE_KEY = "kmitl2025";
const CAMERA_BASE = (process.env.NEXT_PUBLIC_CAMERA_BASE || "").replace(/\/$/, "") || null;
const MAX_PHOTOS = 2;

const PRINT_HOST = (process.env.PRINT_API_HOST || "127.0.0.1");
const PRINT_PORT = (process.env.PRINT_API_PORT || "5000")
const PRINT_BASE = `http://${PRINT_HOST}:${PRINT_PORT}`;

export default function PhotoboothInterface({ user, onLogout }) {
  const router = useRouter();
  const pathname = usePathname();

  const [countdown, setCountdown] = useState(null);
  const [photosTaken, setPhotosTaken] = useState(0);
  const [capturedImage, setCapturedImage] = useState(null);
  const [capturedServerPath, setCapturedServerPath] = useState(null);
  const [sessionPaths, setSessionPaths] = useState([]);
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  // ดีเลย์ปุ่ม 5 วิ หลังถ่ายเสร็จ
  const [buttonsReady, setButtonsReady] = useState(false);
  useEffect(() => {
    if (capturedImage) {
      setButtonsReady(false);
      const t = setTimeout(() => setButtonsReady(true), 5000);
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

  const startPhotoshoot = () => {
    fetch(`${PRINT_BASE}/play/321.wav`);
    let count = 3;
    setCountdown(count);
    const timer = setInterval(() => {
      count--;
      if (count > 0) setCountdown(count);
      else {
        setCountdown("📸");
        setTimeout(() => { setCountdown(null); handleCapture(); }, 500);
        clearInterval(timer);
      }
    }, 1000);
  };

  const handleCapture = async () => {
    try {
      if (!CAMERA_BASE) throw new Error("CAMERA_BASE not set");
      fetch(`${PRINT_BASE}/play/che.wav`);
      const res = await fetch(`${CAMERA_BASE}/capture`, { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!res.ok) throw new Error((await res.text()) || `Capture failed: ${res.status}`);
      const data = await res.json();
      const url = data?.url;
      if (!url) throw new Error("No image url returned");
      setCapturedImage(`${CAMERA_BASE}${url}?ts=${Date.now()}`);
      setCapturedServerPath(data?.serverPath || null);
    } catch (err) {
      //console.error(err);
      toast.error("ถ่ายภาพไม่สำเร็จ");//alert("ถ่ายภาพไม่สำเร็จ");
    }
  };

  const uploadBatchAndGo = async (paths) => {
    const number = user?.phone || user?.number;
    if (!number || !paths.length) return;

    const remotes = [];
    const up1 = await client.uploadAndShare({ folderName: number, filePath: paths[0] });
    if (up1?.share?.url) await client.setNextcloudLink(number, up1.share.url);
    if (up1?.uploaded?.remotePath) remotes.push(up1.uploaded.remotePath);

    for (let i = 1; i < paths.length; i++) {
      const r = await client.uploadOnly({ folderName: number, filePath: paths[i] });
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

        // เรียกสั่งพิมพ์
        try {
        const apiRes = await fetch(`${PRINT_BASE}/print`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paths: nextPaths,          // พาธไฟล์บนเครื่องฝั่งเซิร์ฟเวอร์ (หรือ data:image;base64)
            templateKey: TEMPLATE_KEY, 
          }),
        });
          if (apiRes.ok) {
            fetch(`${PRINT_BASE}/play/print.wav`);
          } else {
            console.error("Print API call failed:", await apiRes.text());
          }
        } catch (err) {
          console.error("Error call Print API:", err);
        }
        return;
      }

      if (CAMERA_BASE) {
        const r = await fetch(`${CAMERA_BASE}/confirm`, { method: "POST" }).catch(() => null);
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
      //alert("ยืนยันรูปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const handleRetake = async () => {
    setCapturedImage(null);
    setCapturedServerPath(null);
    setCountdown(null);
    setLiveLoading(true);
  };

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

      {/* นับถอยหลังกึ่งกลางจอ */}
      {countdown && !capturedImage && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-white drop-shadow-[0_2px_10px_rgba(0,0,0,.7)] text-[20vw] leading-none font-bold select-none">
            {countdown}
          </div>
        </div>
      )}

      {/* แถบควบคุมบน (ซ้าย: Logout / ขวา: Fill/Contain) */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
      <Button
        onClick={onLogout}
        className="bg-rose-500/80 hover:bg-rose-500/90 text-white border border-rose-300/50 backdrop-blur-xl  shadow-lg shadow-cyan-500/50"
        disabled={busy || redirecting}
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
            onClick={() => setFitMode((m) => (m === "cover" ? "contain" : "cover"))}
            className="backdrop-blur-md bg-white/10 text-white border-white/30 hover:bg-white/20"
          >
            {fitMode === "cover" ? "Fill" : "Contain"}
          </Button>
        </div>
      </div>

      {/* แถบปุ่มกึ่งกลางด้านล่าง (กระจกใส + เบลอพื้นหลัง) */}
      <div className="absolute inset-x-0 bottom-6 flex justify-center px-4">
        <div className="w-full max-w-[720px] rounded-2xl border border-white/15 bg-black/35 backdrop-blur-2xl shadow-[0_10px_40px_rgba(0,0,0,.45)] p-3">
          {!capturedImage ? (
            <div className="flex items-center justify-center gap-3">
              {photosTaken < MAX_PHOTOS ? (
                <Button
                  onClick={startPhotoshoot}
                  className="h-16 px-8 text-xl font-bold rounded-xl bg-white text-gray-900 hover:bg-gray-50 shadow-lg"
                  disabled={!CAMERA_BASE || busy || redirecting}
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
                className={`h-14 px-6 text-base md:text-lg rounded-xl border-white/40 text-white bg-white/10 hover:bg-white/20 ${buttonsReady ? "ring-2 ring-rose-500/80 shadow-lg shadow-rose-500 md:shadow-xl md:shadow-rose-500" : "opacity-50 cursor-not-allowed"}`}
                disabled={busy || redirecting || !buttonsReady}
              >
                Retake
              </Button>
              <Button
                onClick={handleConfirmCapture}
                className={`h-14 px-8 text-base md:text-lg font-semibold rounded-xl shadow-lg ${buttonsReady ? "bg-white text-gray-900 hover:bg-gray-50 ring-4 ring-cyan-500/50 shadow-lg shadow-cyan-500 md:shadow-xl md:shadow-cyan-500" : "bg-gray-300 text-gray-600 cursor-not-allowed"}`}
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
    </div>
  );
}
