// components/PhotoboothInterface.js
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { client } from "@/lib/photoboothClient";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const CAMERA_BASE = (process.env.NEXT_PUBLIC_CAMERA_BASE || "").replace(/\/$/, "") || null;
const MAX_PHOTOS = 2;

export default function PhotoboothInterface({ user, onLogout }) {
  const router = useRouter();

  const [countdown, setCountdown] = useState(null);
  const [photosTaken, setPhotosTaken] = useState(0);
  const [capturedImage, setCapturedImage] = useState(null);          // URL แสดงผลจาก Pi
  const [capturedServerPath, setCapturedServerPath] = useState(null); // path จริงบน Pi
  const [sessionPaths, setSessionPaths] = useState([]);              // เก็บ serverPath ทีละใบ
  const [busy, setBusy] = useState(false);

  const [liveSrc, setLiveSrc] = useState(null); // null (ห้ามเป็น "")
  const liveImgRef = useRef(null);

  // ---------- Live preview ----------
  useEffect(() => {
    if (!CAMERA_BASE) return;
    const ts = Date.now();
    setLiveSrc(`${CAMERA_BASE}/video_feed?ts=${ts}`);
    return () => {
      if (liveImgRef.current) liveImgRef.current.removeAttribute("src");
      setLiveSrc(null);
    };
  }, []);

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

  // ---------- Capture ----------
  const handleCapture = async () => {
    try {
      if (!CAMERA_BASE) throw new Error("CAMERA_BASE not set");
      const res = await fetch(`${CAMERA_BASE}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error((await res.text()) || `Capture failed: ${res.status}`);
      const data = await res.json(); // { ok?, url, serverPath }
      const url = data?.url;
      if (!url) throw new Error("No image url returned from /capture");
      setCapturedImage(`${CAMERA_BASE}${url}?ts=${Date.now()}`);
      setCapturedServerPath(data?.serverPath || null);
    } catch (err) {
      console.error(err);
      alert("ถ่ายภาพไม่สำเร็จ");
    }
  };

  // ---------- Confirm & Flow ----------
  // สร้างชื่อไฟล์: เบอร์_YYYYMMDD_รูปที่N.<ext>  (ถ้าเดา ext ไม่ได้ จะใช้ .jpg)
  const buildTargetName = (number, index, localPath) => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}${mm}${dd}`;

    let ext = ".jpg";
    if (typeof localPath === "string") {
      const m = localPath.match(/\.[A-Za-z0-9]+$/);
      if (m) ext = m[0].toLowerCase();
    }
    return `${number}_${dateStr}_รูปที่${index}${ext}`;
  };

  // อัปโหลดชุดภาพทั้งหมด (serverPath) → Nextcloud + บันทึก DB → ไป /dashboard
  const uploadBatchAndGo = async (paths) => {
    const number = user?.phone || user?.number;
    if (!number) throw new Error("missing user number");
    if (!paths.length) return;

    const remotes = [];
    // ใบแรก: upload-and-share (สร้าง/รีใช้ public link) + ตั้งชื่อไฟล์
    const firstPath = paths[0];
    const t1 = buildTargetName(number, 1, firstPath);
    const up1 = await client.uploadAndShare({
      folderName: number,
      filePath: firstPath,
      targetName: t1,
      // note/linkPassword/expiration ใส่เพิ่มได้ตามต้องการ
    });
    if (up1?.share?.url) await client.setNextcloudLink(number, up1.share.url);
    if (up1?.uploaded?.remotePath) remotes.push(up1.uploaded.remotePath);

    // ที่เหลือ: upload-only + ตั้งชื่อไฟล์
    for (let i = 1; i < paths.length; i++) {
      const p = paths[i];
      const targetName = buildTargetName(number, i + 1, p);
      const r = await client.uploadOnly({ folderName: number, filePath: p, targetName });
      if (r?.uploaded?.remotePath) remotes.push(r.uploaded.remotePath);
    }

    // บันทึก remotePath ลง DB (file_address)
    if (remotes.length) {
      await client.appendFileAddress(number, remotes);
    }

    // ไปหน้า dashboard
    router.push("/dashboard");
  };

  // เมื่อกดยืนยันรูป
  const handleConfirmCapture = async () => {
    try {
      setBusy(true);

      // เก็บ path ใบนี้เข้าชุด
      const arr = capturedServerPath ? [...sessionPaths, capturedServerPath] : [...sessionPaths];
      setSessionPaths(arr);

      // แจ้ง Pi ให้กลับไป live (เคลียร์ state)
      if (!CAMERA_BASE) throw new Error("CAMERA_BASE not set");
      const res = await fetch(`${CAMERA_BASE}/confirm`, { method: "POST" });
      if (!res.ok) throw new Error((await res.text()) || `Confirm failed: ${res.status}`);
      const data = await res.json();

      // เคลียร์ preview ชั่วคราว
      setCapturedImage(null);
      setCapturedServerPath(null);

      const nextCount = photosTaken + 1;
      setPhotosTaken(nextCount);

      // ถ้าถ่ายครบ 2 ใบ → อัปโหลดทั้งหมด + ไป /dashboard
      if (nextCount >= MAX_PHOTOS) {
        await uploadBatchAndGo(arr);
        return; // ไม่ต้องกลับเข้า live แล้ว
      }

      // ยังไม่ครบ → กลับเข้า live ต่อ
      const nextLive = data?.video ? `${CAMERA_BASE}${data.video}` : `${CAMERA_BASE}/video_feed?ts=${Date.now()}`;
      setLiveSrc(nextLive);
    } catch (err) {
      console.error(err);
      alert("ยืนยันรูปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const handleRetake = async () => {
    try {
      if (CAMERA_BASE) {
        await fetch(`${CAMERA_BASE}/return_live`, { method: "POST" }).catch(() => {});
        setLiveSrc(`${CAMERA_BASE}/video_feed?ts=${Date.now()}`);
      }
    } catch {}
    setCapturedImage(null);
    setCapturedServerPath(null);
    setCountdown(null);
  };

  const resetSession = () => {
    setPhotosTaken(0);
    setCountdown(null);
    setCapturedImage(null);
    setCapturedServerPath(null);
    setSessionPaths([]);
    if (CAMERA_BASE) setLiveSrc(`${CAMERA_BASE}/video_feed?ts=${Date.now()}`);
  };

  return (
    <Card className="w-96 h-[600px]">
      <CardContent className="flex flex-col gap-4 p-6 h-full">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl">Welcome!</CardTitle>
          <Button variant="outline" onClick={onLogout} className="text-sm" disabled={busy}>
            Logout
          </Button>
        </div>

        <CardDescription>Phone: {user?.phone || user?.number || "-"}</CardDescription>

        <div className="flex-1 flex flex-col justify-center items-center gap-6">
          {/* Preview */}
          <div className="w-full h-64 bg-black rounded-lg overflow-hidden relative">
            {!capturedImage ? (
              liveSrc ? (
                <img
                  ref={liveImgRef}
                  src={liveSrc ?? undefined}  // สำคัญ: ต้องเป็น null/undefined ไม่ใช่ ""
                  alt="Live preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full grid place-items-center text-white/70 text-sm p-4 text-center">
                  {CAMERA_BASE
                    ? "Starting live preview…"
                    : "Camera base URL not set. กรุณาตั้งค่า NEXT_PUBLIC_CAMERA_BASE ใน .env แล้วรีสตาร์ท"}
                </div>
              )
            ) : (
              <img
                src={capturedImage}
                alt="Captured"
                className="w-full h-full object-cover"
              />
            )}
          </div>

          {capturedImage ? (
            <div className="w-full space-y-3">
              <Button
                onClick={handleConfirmCapture}
                className="w-full h-12 text-xl font-bold"
                disabled={busy}
              >
                {busy ? "Processing…" : "Confirm Image"}
              </Button>
              <Button
                variant="outline"
                onClick={handleRetake}
                className="w-full h-12"
                disabled={busy}
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
                <div className="text-xl font-semibold">
                  Photos taken: {photosTaken}/{MAX_PHOTOS}
                </div>
              </div>

              <div className="w-full space-y-3">
                {photosTaken < MAX_PHOTOS ? (
                  <Button
                    onClick={startPhotoshoot}
                    className="w-full h-16 text-2xl font-bold"
                    disabled={!CAMERA_BASE || busy}
                  >
                    Take Photo {photosTaken + 1}
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="text-center text-green-600 font-bold text-xl">
                      ✅ Session Complete!
                    </div>
                    <Button
                      onClick={resetSession}
                      className="w-full h-12 text-xl"
                      disabled={busy}
                    >
                      Start New Session
                    </Button>
                  </div>
                )}

                {photosTaken > 0 && photosTaken < MAX_PHOTOS && (
                  <Button
                    variant="outline"
                    onClick={resetSession}
                    className="w-full h-12"
                    disabled={busy}
                  >
                    Reset Session
                  </Button>
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
