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

const TEMPLATE_KEY = process.env.TEMPLATE || "kmitl2025";
const CAMERA_BASE =
  (process.env.NEXT_PUBLIC_CAMERA_BASE || "").replace(/\/$/, "") || null;
const MAX_PHOTOS = 2;

// Optional shutter-sound offset (ms). 0 = play immediately, >0 = delay after capture start, <0 = play before capture
const CHE_OFFSET_MS = Number(process.env.NEXT_PUBLIC_CHE_OFFSET_MS ?? 0) || 0;
// Mirror live preview like a selfie (does not affect saved photo)
const LIVE_MIRROR = (process.env.NEXT_PUBLIC_LIVE_MIRROR ?? "true").toLowerCase() === "true";
// Edge flash effect config (color & thickness)
const EDGE_COLOR = (process.env.NEXT_PUBLIC_SHUTTER_EDGE_COLOR || "#22d3ee").trim();
const EDGE_THICKNESS = Number(process.env.NEXT_PUBLIC_SHUTTER_EDGE_PX ?? 100) || 100;

const PRINT_HOST = process.env.PRINT_API_HOST || "127.0.0.1";
const PRINT_PORT = process.env.PRINT_API_PORT || "5000";
const PRINT_BASE = `http://${PRINT_HOST}:${PRINT_PORT}`;
const DELETE_AFTER_UPLOAD =
  (process.env.NEXT_PUBLIC_DELETE_RECENT_AFTER_UPLOAD || "false")
    .toLowerCase() === "true";

export default function PhotoboothInterface({ user, onLogout }) {
  const router = useRouter();
  const pathname = usePathname();

  // ===== Core States =====
  const [countdown, setCountdown] = useState(null);
  const [shooting, setShooting] = useState(false);
  const [preMessage, setPreMessage] = useState(false);
  const [photosTaken, setPhotosTaken] = useState(0);
  const [capturedImage, setCapturedImage] = useState(null);
  const [capturedServerPath, setCapturedServerPath] = useState(null);
  const [sessionPaths, setSessionPaths] = useState([]);
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  // ===== Reconnect visual state =====
  const wasLiveRef = useRef(false);
  const [reconnecting, setReconnecting] = useState(false);

  // ===== Session key to avoid stream conflicts =====
  const SESSION_KEY = useMemo(() => {
    if (typeof window === "undefined") return null;
    let s = sessionStorage.getItem("camSession");
    if (!s) {
      s = crypto.randomUUID();
      sessionStorage.setItem("camSession", s);
    }
    return s;
  }, []);

  // ===== Delay confirm/retake buttons a bit after capture =====
  const [buttonsReady, setButtonsReady] = useState(false);
  useEffect(() => {
    if (capturedImage) {
      setButtonsReady(false);
      const t = setTimeout(() => setButtonsReady(true), 2500);
      return () => clearTimeout(t);
    }
    setButtonsReady(false);
  }, [capturedImage]);

  // ===== Live preview states/refs =====
  const [liveSrc, setLiveSrc] = useState(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const liveImgRef = useRef(null);

  // ให้ Loader ค้างครอบแบล็คเฟรมสักครู่ (เพื่อกันกระพริบ)
  const suppressOnLoadUntil = useRef(0);
  const HOLD_MS = 500;

  // Fit mode for <img> (kept as in your UI)
  const [fitMode, setFitMode] = useState("cover");
  const objectClass = useMemo(
    () => (fitMode === "cover" ? "object-cover" : "object-contain"),
    [fitMode]
  );

  // Shutter edge-flash (4-side glow)
  const [flashOn, setFlashOn] = useState(false);
  const triggerShutterFX = () => {
    try { setFlashOn(false); } catch {}
    setTimeout(() => { try { setFlashOn(true); } catch {} }, 0);
    setTimeout(() => { try { setFlashOn(false); } catch {} }, 650);
  };
  const playCheNow = () => {
    try { playCheNow(); } catch {}
    try { triggerShutterFX(); } catch {}
  };

  // ===== Retry/backoff for live preview + warm-up guard =====
  const retryRef = useRef({ tries: 0, timer: null });
  const liveStartAtRef = useRef(0);
  const MAX_RETRY = 10;
  const baseDelay = 900;
  const jitter = () => Math.random() * 300;

  const makeLiveUrl = (fresh = false) => {
    if (!CAMERA_BASE) return null;
    const ts = Date.now();
    const f = fresh ? "&fresh=1" : "";
    return `${CAMERA_BASE}/video_feed?autoconfirm=1&session=${SESSION_KEY}${f}&ts=${ts}`;
  };

  const resetRetry = () => {
    try { clearTimeout(retryRef.current.timer); } catch {}
    retryRef.current.tries = 0;
    retryRef.current.timer = null;
  };

  const wakeCamera = async () => {
    if (!CAMERA_BASE) return;
    try { await fetch(`${CAMERA_BASE}/api/wake`, { method: "POST" }); } catch {}
  };

  const reloadLive = (delay = baseDelay) => {
    try { clearTimeout(retryRef.current.timer); } catch {}
    retryRef.current.timer = setTimeout(async () => {
      if (capturedImage || redirecting || busy || photosTaken >= MAX_PHOTOS) return;
      retryRef.current.tries = Math.min(retryRef.current.tries + 1, MAX_RETRY);
      await wakeCamera();
      const url = makeLiveUrl(true);
      if (url) {
        setReconnecting(true);
        suppressOnLoadUntil.current = Date.now() + HOLD_MS;
        liveStartAtRef.current = Date.now();
        setLiveSrc(url);
        setLiveLoading(true);
      }
    }, delay + jitter());
  };

  // ===== Health-check + auto-recover =====
  const healthTimerRef = useRef(null);
  const startHealthWatch = useMemo(
    () => () => {
      clearInterval(healthTimerRef.current);
      if (!CAMERA_BASE) return;

      const tick = async () => {
        if (Date.now() - (liveStartAtRef.current || 0) < 3000) return;
        if (capturedImage || redirecting || busy) return;
        if (photosTaken >= MAX_PHOTOS) return;

        try {
          const r = await fetch(`${CAMERA_BASE}/api/health`, { cache: "no-store" });
          const h = await r.json().catch(() => ({}));

          // ถ้า live หยุด/พัก → ปลุก + รีคอนเนค
          if (!h?.running || h?.paused) {
            await wakeCamera();
            reloadLive(450);
          }
        } catch {
          await wakeCamera();
          reloadLive(1200);
        }
      };

      tick().catch(() => {});
      healthTimerRef.current = setInterval(tick, 5000);
    },
    [CAMERA_BASE, SESSION_KEY, capturedImage, redirecting, busy, photosTaken]
  );

  useEffect(() => {
    startHealthWatch();
    return () => clearInterval(healthTimerRef.current);
  }, [startHealthWatch]);

  useEffect(() => {
    return () => {
      try { clearInterval(healthTimerRef.current); } catch {}
      try { clearTimeout(retryRef.current.timer); } catch {}
    };
  }, []);

  // ===== Start/stop live with page mount/unmount =====
  const stopCamera = async () => {
    if (!CAMERA_BASE) return;
    try {
      await Promise.any([
        fetch(`${CAMERA_BASE}/stop_stream`, { method: "POST" }),
        fetch(`${CAMERA_BASE}/stop`, { method: "POST" }),
        fetch(`${CAMERA_BASE}/pause`, { method: "POST" }),
      ]).catch(() => {});
    } catch {}
  };

  const deleteRecentOnServer = async (count = 2) => {
    if (!CAMERA_BASE || !DELETE_AFTER_UPLOAD) return;
    try {
      await fetch(`${CAMERA_BASE}/api/delete_recent?count=${count}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      console.warn("delete_recent failed:", e);
    }
  };

  const initLiveFirstTime = useRef(null);
  initLiveFirstTime.current = async () => {
    setLiveLoading(true);
    resetRetry();
    await wakeCamera();
    const url = makeLiveUrl(true);
    if (url) {
      suppressOnLoadUntil.current = Date.now() + HOLD_MS;
      liveStartAtRef.current = Date.now();
      setLiveSrc(url);
    }
  };

  useEffect(() => {
    if (!CAMERA_BASE || pathname !== "/booth" || !SESSION_KEY) return;

    initLiveFirstTime.current?.();

    return () => {
      try {
        if (liveImgRef.current) liveImgRef.current.removeAttribute("src");
      } catch {}
      setLiveSrc(null);
      setLiveLoading(true);
      resetRetry();
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, CAMERA_BASE, SESSION_KEY]);

  // ===== Handlers for live <img> =====
  const onLiveLoad = () => {
    const now = Date.now();
    if (now >= suppressOnLoadUntil.current) {
      setLiveLoading(false);
    } else {
      setTimeout(() => setLiveLoading(false), suppressOnLoadUntil.current - now);
    }
    wasLiveRef.current = true;
    setReconnecting(false);
    resetRetry();
  };
  const onLiveError = () => {
    setLiveLoading(false);
    setReconnecting(true);
    const tries = retryRef.current.tries;
    const nextDelay = Math.min(baseDelay * (1 + tries), 3000);
    reloadLive(nextDelay);
  };

  // ===== Photo flow: overlay -> countdown -> capture =====
  const startPhotoshoot = () => {
    if (shooting || busy) return;
    setShooting(true);
    setPreMessage(true);

    setTimeout(() => {
      setPreMessage(false);
      fetch(`${PRINT_BASE}/play/321.wav`).catch(() => {});
      let count = 3;
      setCountdown(count);
      const timer = setInterval(async () => {
        count -= 1;
        // Pre‑arm the camera ~1s before shutter to remove DSLR toggle lag
        if (count === 1 && CAMERA_BASE) {
          try { await fetch(`${CAMERA_BASE}/api/prepare_shot`, { method: "POST" }); } catch {}
        }
        if (count > 0) setCountdown(count);
        else {
          setCountdown("📸");
          setCountdown(null);
          handleCapture();
          clearInterval(timer);
        }
      }, 1000);
    }, 2800);
  };

  // ===== Capture with hard-timeout + session (zero‑lag ordering) =====
  const handleCapture = async () => {
    if (!CAMERA_BASE || !SESSION_KEY) return;
    setBusy(true);

    const ctrl = new AbortController();
    const CAPTURE_TIMEOUT_MS = 6500;
    const kill = setTimeout(() => ctrl.abort(), CAPTURE_TIMEOUT_MS);

    try {
      // Fire capture FIRST, then play the shutter sound immediately → perceived zero‑lag
      // If user wants sound BEFORE capture, play then wait abs(offset) (capped 1200ms)
      if (CHE_OFFSET_MS < 0) {
        try { playCheNow(); } catch {}
        await new Promise((r) => setTimeout(r, Math.min(1200, Math.abs(CHE_OFFSET_MS))));
      }

      // Start capture request
      const capPromise = fetch(`${CAMERA_BASE}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: SESSION_KEY }),
        signal: ctrl.signal,
      });

      // If offset is >= 0, schedule sound AFTER capture start
      if (CHE_OFFSET_MS >= 0) {
        if (CHE_OFFSET_MS === 0) { try { playCheNow(); } catch {} }
        else { setTimeout(() => { try { playCheNow(); } catch {} }, Math.min(1200, CHE_OFFSET_MS)); }
      }

      const res = await capPromise;
      if (!res.ok) {
        if (res.status === 429 || res.status === 410) {
          await fetch(`${CAMERA_BASE}/confirm`, { method: "POST" }).catch(() => {});
          reloadLive(1200);
        }
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Capture failed: ${res.status}`);
      }

      const data = await res.json().catch(() => ({}));
      const url = data?.url;
      const serverPath = data?.serverPath || data?.path || null;

      if (!url) throw new Error("No image url returned");
      setCapturedImage(`${CAMERA_BASE}${url}?ts=${Date.now()}`);
      setCapturedServerPath(serverPath);

      try {
        if (liveImgRef.current) liveImgRef.current.removeAttribute("src");
      } catch {}
      setLiveSrc(null);
      setLiveLoading(true);
    } catch (err) {
      console.error("Capture error:", err);
      toast.error("การเชื่อมต่อผิดพลาด ถ่ายภาพไม่สำเร็จ");
      await fetch(`${CAMERA_BASE}/confirm`, { method: "POST" }).catch(() => {});
      reloadLive(1200);
    } finally {
      clearTimeout(kill);
      setBusy(false);
      setShooting(false);
    }
  };

  // ===== Upload batch then navigate =====
  const uploadBatchAndGo = async (paths) => {
    const number = user?.phone || user?.number;
    if (!number || !paths?.length) return;

    try {
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
      await deleteRecentOnServer(2);
    } catch (e) {
      console.error("uploadBatchAndGo failed:", e);
    } finally {
      try {
        if (liveImgRef.current) liveImgRef.current.removeAttribute("src");
      } catch {}
      setLiveSrc(null);
      await stopCamera().catch(() => {});
      setRedirecting(true);
      router.push("/dashboard");
    }
  };

  // ===== Confirm photo =====
  const handleConfirmCapture = async () => {
    try {
      setBusy(true);
      const nextPaths = capturedServerPath
        ? [...sessionPaths, capturedServerPath]
        : [...sessionPaths];
      const nextCount = photosTaken + 1;

      setCapturedImage(null);
      setCapturedServerPath(null);
      setSessionPaths(nextPaths);
      setPhotosTaken(nextCount);

      if (nextCount >= MAX_PHOTOS) {
        try { clearInterval(healthTimerRef.current); } catch {}
        try {
          if (liveImgRef.current) liveImgRef.current.removeAttribute("src");
        } catch {}
        setLiveSrc(null);
        await stopCamera().catch(() => {});
        await uploadBatchAndGo(nextPaths);

        // Print
        try {
          const apiRes = await fetch(`${PRINT_BASE}/print`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths: nextPaths, templateKey: TEMPLATE_KEY }),
          });
          if (apiRes.ok) {
            fetch(`${PRINT_BASE}/play/print.wav`).catch(() => {});
          } else {
            console.log("Print API call failed:", await apiRes.text());
            toast.error("ไม่สามารถปริ้นได้ เนื่องจากไม่ได้ต่อปริ้นเตอร์");
          }
        } catch (err) {
          console.log("Print API error:", err);
          toast.error("Print error:", err?.message || "Unknown");
        }
        return;
      }

      // เริ่ม live ใหม่ (fresh=1) เพื่อถ่ายภาพต่อ
      if (CAMERA_BASE) {
        const r = await fetch(`${CAMERA_BASE}/confirm`, { method: "POST" }).catch(
          () => null
        );
        let nextLive = makeLiveUrl(true);
        if (r && r.ok) {
          const data = await r.json().catch(() => ({}));
          if (data?.video) nextLive = `${CAMERA_BASE}${data.video}?ts=${Date.now()}`;
        }
        setLiveLoading(true);
        suppressOnLoadUntil.current = Date.now() + HOLD_MS;
        liveStartAtRef.current = Date.now();
        setLiveSrc(nextLive);
      }
    } catch (err) {
      console.error("handleConfirmCapture error:", err);
    } finally {
      setBusy(false);
    }
  };

  // ===== Retake photo =====
  const handleRetake = async () => {
    try {
      setBusy(true);
      setCapturedImage(null);
      setCapturedServerPath(null);
      setCountdown(null);

      if (CAMERA_BASE) {
        const r = await fetch(`${CAMERA_BASE}/confirm`, { method: "POST" }).catch(
          () => null
        );
        let nextLive = makeLiveUrl(true);
        if (r && r.ok) {
          try {
            const data = await r.json();
            if (data?.video)
              nextLive = `${CAMERA_BASE}${data.video}?ts=${Date.now()}`;
          } catch {}
        }
        liveStartAtRef.current = Date.now();
        suppressOnLoadUntil.current = Date.now() + HOLD_MS;
        setLiveSrc(nextLive);
      }
    } finally {
      setLiveLoading(true);
      setBusy(false);
    }
  };

  const hideUi = shooting && !capturedImage;

  // ====== RETURN (UI unchanged except reconnect copy) ======
  return (
    <div className="fixed inset-0 z-20 bg-black">
      {/* ชั้นภาพ (เต็มจอ) */}
      <div className="absolute inset-0">
        {!capturedImage && (liveLoading || !liveSrc) && (
          <div className="absolute inset-0 grid place-items-center text-white/90">
            <div className="flex flex-col items-center gap-3">
              <Loader />
              <div className="text-sm opacity-80">
                {wasLiveRef.current ? "Reconnecting to camera…" : "Starting live preview…"}
              </div>
            </div>
          </div>
        )}

        {!capturedImage ? (
          liveSrc ? (
            <img
              ref={liveImgRef}
              src={liveSrc ?? undefined}
              alt="Live preview"
              className={`w-full h-full ${objectClass} select-none transform`}
              style={{ transform: LIVE_MIRROR ? 'scaleX(-1)' : undefined }}
              onLoad={onLiveLoad}
              onError={onLiveError}
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
          <div className="absolute inset-0 bg-neutral-950/85" />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(60% 50% at 50% 40%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 60%)",
            }}
          />
          <div className="relative z-10 text-center px-6 font-sans tracking-tight">
            <h1
              className="mx-auto font-semibold text-white animate-zoomIn"
              style={{ fontSize: "clamp(28px, 6.6vw, 64px)", lineHeight: 1.1 }}
            >
              กรุณามองกล้องด้านบน
            </h1>
            <p
              className="mt-3 mx-auto text-white/80 animate-fadeInSlow"
              style={{ fontSize: "clamp(14px, 2.2vw, 20px)" }}
            >
              ยิ้มสวย ๆ ความสวยกำลังถูกบันทึกไว้!
            </p>
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
                  <linearGradient id="arrowStroke" x1="0" y1="156" x2="0" y2="0" gradientUnits="userSpaceOnUse">
                    <stop offset="0%"  stopColor="rgba(255,255,255,0.85)"/>
                    <stop offset="55%" stopColor="rgba(255,255,255,1)"/>
                    <stop offset="100%" stopColor="rgba(255,255,255,0.85)"/>
                    <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="0 -24" dur="2.2s" repeatCount="indefinite"/>
                  </linearGradient>
                  <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
                    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>
                  <linearGradient id="edgeHighlight" x1="0" y1="156" x2="0" y2="0">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.12)"/>
                    <stop offset="100%" stopColor="rgba(255,255,255,0.28)"/>
                  </linearGradient>
                </defs>
                <path d="M54 140 L54 44" stroke="url(#arrowStroke)" strokeWidth="10" strokeLinecap="round" filter="url(#softGlow)"/>
                <path d="M54 18 L31 50 L77 50 Z" fill="white" filter="url(#softGlow)"/>
                <path d="M54 140 L54 44" stroke="url(#edgeHighlight)" strokeWidth="12" strokeLinecap="round" style={{ opacity: 0.35, filter: "blur(6px)" }}/>
                <circle cx="54" cy="26" r="2.5" fill="white" opacity="0.9">
                  <animate attributeName="r" values="2;4;2" dur="1.8s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.8s" repeatCount="indefinite"/>
                </circle>
              </svg>
            </div>
            <div className="mt-4 inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-white/90 text-sm">
              กล้องอยู่ด้านบนของหน้าจอ
            </div>
          </div>
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

      {/* Top bar (Logout + Connection + Minimal Steps + Fit/Counter) */}
      <div
        className={`absolute top-4 left-4 right-4 flex items-center justify-between gap-3 transition-all duration-200 ${
          hideUi ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
      >
        {/* Left cluster: Logout + Connection */}
        <div className="flex items-center gap-3">
          <Button
            onClick={onLogout}
            className="bg-rose-500/80 hover:bg-rose-500/90 text-white border border-rose-300/50 backdrop-blur-xl shadow"
            disabled={busy || redirecting || hideUi}
          >
            Logout
          </Button>

          {/* Connection Chip (minimal) */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/15">
            <span
              className={`inline-flex h-2 w-2 rounded-full ${
                liveLoading ? "bg-yellow-400" : liveSrc ? "bg-emerald-400" : "bg-rose-500"
              }`}
            />
            <span className="text-xs text-white/80">
              {reconnecting ? "Reconnecting" : liveLoading ? "Connecting" : liveSrc ? "Ready" : "Offline"}
            </span>
          </div>
        </div>

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

      {/* แถบปุ่มกึ่งกลางด้านล่าง */}
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

      {/* Shutter edge-flash overlay */}
      {flashOn && (
        <div className="absolute inset-0 pointer-events-none z-[60] edge-flash">
          {/* Top */}
          <div
            className="absolute left-0 right-0"
            style={{
              top: 0,
              height: EDGE_THICKNESS,
              background: `linear-gradient(to bottom, ${EDGE_COLOR}, transparent)`,
              filter: "blur(6px)",
              opacity: 0.95,
            }}
          />
          {/* Bottom */}
          <div
            className="absolute left-0 right-0"
            style={{
              bottom: 0,
              height: EDGE_THICKNESS,
              background: `linear-gradient(to top, ${EDGE_COLOR}, transparent)`,
              filter: "blur(6px)",
              opacity: 0.95,
            }}
          />
          {/* Left */}
          <div
            className="absolute top-0 bottom-0"
            style={{
              left: 0,
              width: EDGE_THICKNESS,
              background: `linear-gradient(to right, ${EDGE_COLOR}, transparent)`,
              filter: "blur(6px)",
              opacity: 0.95,
            }}
          />
          {/* Right */}
          <div
            className="absolute top-0 bottom-0"
            style={{
              right: 0,
              width: EDGE_THICKNESS,
              background: `linear-gradient(to left, ${EDGE_COLOR}, transparent)`,
              filter: "blur(6px)",
              opacity: 0.95,
            }}
          />
        </div>
      )}

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
          100% { opacity: 1; transform: scale(1);
          }
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
        @keyframes edgeFlash {
          0%   { opacity: 0; transform: scale(1.02); }
          10%  { opacity: 1;  transform: scale(1.00); }
          70%  { opacity: 0.85; }
          100% { opacity: 0;  transform: scale(0.998); }
        }
        .edge-flash { animation: edgeFlash 560ms ease-out both; }
      `}</style>
    </div>
  );
}
