// components/PromotionSuccessCard.js
"use client";

import { useEffect } from "react";

/**
 * PromotionSuccessCard
 * - แสดงผลสำเร็จเมื่อใช้คูปอง
 * - ถ้า isFree = true จะแสดงเอฟเฟกต์พิเศษ (confetti + gradient “ฟรี 100%”)
 * - แสดงตามเวลาที่กำหนด (seconds) แล้วเรียก onDone()
 * - ถ้ามี playSoundUrl จะ fetch() เล่นเสียงตอนการ์ดแสดงครั้งแรก
 *
 * Props:
 * - amount: number   // ส่วนลดเป็นบาท (เช่น 50)
 * - isFree: boolean  // true = ฟรี 100%
 * - seconds: number  // ระยะเวลาที่แสดง (วินาที) default 2
 * - onDone: () => void   // callback หลังครบเวลา
 * - playSoundUrl?: string // เช่น `${PRINT_BASE}/play/couponuse.wav`
 */
export default function PromotionSuccessCard({
  amount = 0,
  isFree = false,
  seconds = 2,
  onDone = () => {},
  playSoundUrl,
}) {
  // เล่นเสียงครั้งเดียวตอน mount
  useEffect(() => {
    if (playSoundUrl) {
      try { fetch(playSoundUrl); } catch {}
    }
  }, [playSoundUrl]);

  // ตั้งเวลา auto-close
  useEffect(() => {
    const t = setTimeout(() => onDone(), Math.max(0, seconds * 1000));
    return () => clearTimeout(t);
  }, [seconds, onDone]);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 backdrop-blur-sm">
      <div className="relative w-[340px] max-w-[90vw] rounded-2xl border shadow-2xl bg-white/90 dark:bg-gray-900/90 p-6 text-center">
        <div
          className={[
            "mx-auto mb-3 h-16 w-16 rounded-full grid place-items-center ring-4",
            isFree ? "ring-amber-300/70 bg-amber-50 dark:bg-amber-900/20"
                  : "ring-emerald-300/60 bg-emerald-50 dark:bg-emerald-900/20",
          ].join(" ")}
        >
          {/* Animated check icon */}
          <svg
            viewBox="0 0 52 52"
            className={[
              "w-10 h-10",
              isFree ? "text-amber-500 dark:text-amber-300"
                     : "text-emerald-600 dark:text-emerald-400",
            ].join(" ")}
          >
            <circle className="ckmk-circle" cx="26" cy="26" r="24" fill="none" strokeWidth="3" />
            <path className="ckmk-check" fill="none" strokeWidth="4" d="M14 27 l8 8 16-16" />
          </svg>
        </div>

        <h3 className="text-lg font-semibold">ใช้คูปองสำเร็จ</h3>

        {!isFree ? (
          <>
            <p className="text-sm mt-1 opacity-80">ได้รับส่วนลด</p>
            <div className="text-3xl font-extrabold mt-1">฿{Number(amount || 0).toLocaleString()}</div>
            <p className="text-xs opacity-70 mt-2">กำลังไปยังขั้นตอนถัดไป…</p>

            {/* progress bar ตาม seconds */}
            <div className="mt-4 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
              <div
                className="h-2 bg-gradient-to-r from-emerald-400 via-lime-400 to-teal-400"
                style={{
                  animation: `couponbar ${Math.max(0.2, seconds)}s linear forwards`,
                }}
              />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm mt-1 opacity-80">ว้าว! ส่วนลดพิเศษ</p>
            <div className="mt-1 text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-fuchsia-400 via-amber-400 to-emerald-400 animate-[pulse_1.2s_ease-in-out_infinite]">
              ฟรี 100%
            </div>
            <p className="text-xs opacity-70 mt-2">ไม่ต้องชำระเงิน — กำลังไปยังหน้า “ถ่ายรูป”…</p>

            {/* progress bar ทอง ๆ */}
            <div className="mt-4 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
              <div
                className="h-2 bg-gradient-to-r from-amber-300 via-yellow-400 to-emerald-300"
                style={{
                  animation: `couponbar ${Math.max(0.2, seconds)}s linear forwards`,
                }}
              />
            </div>

            {/* confetti */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {Array.from({ length: 28 }).map((_, i) => (
                <span
                  key={i}
                  className="absolute text-lg select-none"
                  style={{
                    left: `${(i * 37) % 100}%`,
                    top: `-10%`,
                    animation: `confetti ${seconds + 0.6 + (i % 4) * 0.2}s linear ${i * 0.04}s forwards`,
                  }}
                >
                  🎉
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* styled-jsx สำหรับแอนิเมชันเส้นวง/ติ๊ก + แถบเวลา + confetti */}
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
        @keyframes couponbar { from { width: 0%; } to { width: 100%; } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .6; } }
        @keyframes confetti {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          95% { opacity: 1; }
          100% { transform: translateY(120vh) rotate(540deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
