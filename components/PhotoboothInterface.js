// components/PhotoboothInterface.js
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { client } from "@/lib/photoboothClient";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/shadcn-io/ai/loader";

const CAMERA_BASE = (process.env.NEXT_PUBLIC_CAMERA_BASE || "").replace(/\/$/, "") || null;
const MAX_PHOTOS = 2;

export default function PhotoboothInterface({ user, onLogout }) {
  const router = useRouter();
  const pathname = usePathname();

  const [countdown, setCountdown] = useState(null);
  const [photosTaken, setPhotosTaken] = useState(0);
  const [capturedImage, setCapturedImage] = useState(null);           // preview รูปล่าสุด
  const [capturedServerPath, setCapturedServerPath] = useState(null); // path ฝั่ง Pi
  const [sessionPaths, setSessionPaths] = useState([]);               // เก็บครบ 2 ใบ
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  // live preview
  const [liveSrc, setLiveSrc] = useState(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const liveImgRef = useRef(null);

  // ---------- helper: สั่งหยุดกล้อง ----------
  const stopCamera = async () => {
    if (!CAMERA_BASE) return;
    try {
      await Promise.any([
        fetch(`${CAMERA_BASE}/stop_stream`, { method: "POST" }),
        fetch(`${CAMERA_BASE}/stop`, { method: "POST" }),
      ]);
    } catch {}
  };

  // ---------- เริ่ม live เฉพาะหน้า /booth ----------
  useEffect(() => {
    if (!CAMERA_BASE) return;
    if (pathname !== "/booth") return;

    setLiveLoading(true);
    setLiveSrc(`${CAMERA_BASE}/video_feed?ts=${Date.now()}`);

    // ออกจากหน้า /booth หรือ component ถูก unmount → หยุดกล้อง
    return () => {
      if (liveImgRef.current) liveImgRef.current.removeAttribute("src");
      setLiveSrc(null);
      setLiveLoading(true);
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // ---------- 3-2-1 ถ่าย ----------
  const startPhotoshoot = () => {
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

  // ---------- สั่งกล้องถ่าย ----------
  const handleCapture = async () => {
    try {
      if (!CAMERA_BASE) throw new Error("CAMERA_BASE not set");
      const res = await fetch(`${CAMERA_BASE}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error((await res.text()) || `Capture failed: ${res.status}`);
      const data = await res.json(); // { url, serverPath }
      const url = data?.url;
      if (!url) throw new Error("No image url returned from /capture");
      setCapturedImage(`${CAMERA_BASE}${url}?ts=${Date.now()}`);
      setCapturedServerPath(data?.serverPath || null);
    } catch (err) {
      console.error(err);
      alert("ถ่ายภาพไม่สำเร็จ");
    }
  };

  // ---------- อัปโหลดทั้งหมด & redirect (ไม่เปลี่ยนชื่อไฟล์) ----------
  const uploadBatchAndGo = async (paths) => {
    const number = user?.phone || user?.number;
    if (!number || !paths.length) return;

    const remotes = [];

    // ใบแรก: upload-and-share
    const up1 = await client.uploadAndShare({ folderName: number, filePath: paths[0] });
    if (up1?.share?.url) await client.setNextcloudLink(number, up1.share.url);
    if (up1?.uploaded?.remotePath) remotes.push(up1.uploaded.remotePath);

    // ใบที่เหลือ: upload-only
    for (let i = 1; i < paths.length; i++) {
      const r = await client.uploadOnly({ folderName: number, filePath: paths[i] });
      if (r?.uploaded?.remotePath) remotes.push(r.uploaded.remotePath);
    }

    if (remotes.length) await client.appendFileAddress(number, remotes);

    // กันพลาด: ตัด src ของ live แล้วหยุดกล้องก่อนออก
    if (liveImgRef.current) liveImgRef.current.removeAttribute("src");
    setLiveSrc(null);
    await stopCamera().catch(() => {});

    setRedirecting(true);
    router.push("/dashboard");
  };

  // ---------- ยืนยันรูป ----------
  const handleConfirmCapture = async () => {
    try {
      setBusy(true);

      const nextPaths = capturedServerPath ? [...sessionPaths, capturedServerPath] : [...sessionPaths];
      const nextCount = photosTaken + 1;

      // เคลียร์ภาพ preview ที่โชว์อยู่
      setCapturedImage(null);
      setCapturedServerPath(null);

      setSessionPaths(nextPaths);
      setPhotosTaken(nextCount);

      if (nextCount >= MAX_PHOTOS) {
        if (liveImgRef.current) liveImgRef.current.removeAttribute("src");
        setLiveSrc(null);
        await stopCamera().catch(() => {});
        await uploadBatchAndGo(nextPaths);
        return;
      }

      // รูปที่ 1: กลับไป live ต่อเพื่อถ่ายใบที่ 2
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
      alert("ยืนยันรูปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const handleRetake = async () => {
    setCapturedImage(null);
    setCapturedServerPath(null);
    setCountdown(null);
    // live ยังทำงานอยู่ ไม่ต้องสั่งเพิ่ม
  };

  return (
    <Card className="w-96 h-[600px]">
      <CardContent className="flex flex-col gap-4 p-6 h-full">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl">Welcome!</CardTitle>
          <Button variant="outline" onClick={onLogout} className="text-sm" disabled={busy || redirecting}>
            Logout
          </Button>
        </div>

        <CardDescription>Phone: {user?.phone || user?.number || "-"}</CardDescription>

        <div className="flex-1 flex flex-col justify-center items-center gap-6">
          {/* กล่องแสดงผล */}
          <div className="w-full h-64 bg-black rounded-lg overflow-hidden relative">
            {!capturedImage && (liveLoading || !liveSrc) && (
              <div className="absolute inset-0 grid place-items-center text-white/80">
                <div className="flex flex-col items-center gap-3">
                  <Loader />
                  <div className="text-xs opacity-80">Starting live preview…</div>
                </div>
              </div>
            )}

            {!capturedImage ? (
              liveSrc ? (
                <img
                  ref={liveImgRef}
                  src={liveSrc ?? undefined}
                  alt="Live preview"
                  className="w-full h-full object-cover"
                  onLoad={() => setLiveLoading(false)}
                  onError={() => setLiveLoading(false)}
                />
              ) : (
                <div className="w-full h-full grid place-items-center text-white/70 text-sm p-4 text-center">
                  {CAMERA_BASE ? (<><Loader /><div className="mt-2">Starting live preview…</div></>) : "Camera base URL not set"}
                </div>
              )
            ) : (
              <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
            )}
          </div>

          {capturedImage ? (
            <div className="w-full space-y-3">
              <Button
                onClick={handleConfirmCapture}
                className="w-full h-12 text-xl font-bold"
                disabled={busy || redirecting}
              >
                {busy ? "Processing…" : "Confirm Image"}
              </Button>
              <Button
                variant="outline"
                onClick={handleRetake}
                className="w-full h-12"
                disabled={busy || redirecting}
              >
                Retake Photo
              </Button>
            </div>
          ) : countdown ? (
            <div className="text-8xl font-bold text-center">{countdown}</div>
          ) : (
            <>
              <div className="text-center">
                <div className="text-6xl mb-4">📷</div>
                <div className="text-xl font-semibold">Photos taken: {photosTaken}/{MAX_PHOTOS}</div>
              </div>

              <div className="w-full space-y-3">
                {photosTaken < MAX_PHOTOS ? (
                  <Button
                    onClick={startPhotoshoot}
                    className="w-full h-16 text-2xl font-bold"
                    disabled={!CAMERA_BASE || busy || redirecting}
                  >
                    Take Photo {photosTaken + 1}
                  </Button>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="text-green-600 font-bold text-xl">
                      ✅ Session Complete! {redirecting ? "Redirecting…" : ""}
                    </div>
                    <Loader />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="text-center text-sm text-gray-500">
          Session: ฿50 • {MAX_PHOTOS} photos included
        </div>
      </CardContent>
    </Card>
  );
}
