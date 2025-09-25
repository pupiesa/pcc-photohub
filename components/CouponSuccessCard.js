// components/CouponSuccessCard.js
"use client";
import { useEffect } from "react";

/**
 * CouponSuccessCard
 * - แสดง overlay + การ์ดบอกยอดส่วนลด
 * - แอนิเมชันไอคอนติ๊ก + แถบ 3 วิ
 * - auto close หลังครบ durationMs แล้วเรียก onFinish()
 *
 * Props:
 *   open: boolean
 *   amount: number (ส่วนลดเป็นบาท)
 *   durationMs?: number (default 3000)
 *   onFinish?: () => void
 */
export default function CouponSuccessCard({ open, amount = 0, durationMs = 3000, onFinish = () => {} }) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => onFinish(), durationMs);
    return () => clearTimeout(t);
  }, [open, durationMs, onFinish]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 backdrop-blur-sm">
      <div className="relative w-[340px] max-w-[90vw] rounded-2xl border shadow-2xl bg-white/90 dark:bg-gray-900/90 p-6 text-center">
        <div className="mx-auto mb-3 h-16 w-16 rounded-full grid place-items-center ring-4 ring-emerald-300/60 bg-emerald-50 dark:bg-emerald-900/20">
          {/* Animated check icon */}
          <svg viewBox="0 0 52 52" className="w-10 h-10 text-emerald-600 dark:text-emerald-400">
            <circle className="ckmk-circle" cx="26" cy="26" r="24" fill="none" strokeWidth="3" />
            <path className="ckmk-check" fill="none" strokeWidth="4" d="M14 27 l8 8 16-16" />
          </svg>
        </div>

        <h3 className="text-lg font-semibold">ใช้คูปองสำเร็จ</h3>
        <p className="text-sm mt-1 opacity-80">ได้รับส่วนลด</p>
        <div className="text-3xl font-extrabold mt-1">฿{Number(amount || 0).toLocaleString()}</div>
        <p className="text-xs opacity-70 mt-2">กำลังไปยังหน้า “ถ่ายรูป”…</p>

        {/* progress bar 3s */}
        <div className="mt-4 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
          <div className="h-2 bg-gradient-to-r from-emerald-400 via-lime-400 to-teal-400 animate-[couponbar_3s_linear_forwards]" />
        </div>
      </div>

      {/* styled-jsx สำหรับแอนิเมชันเส้นวง/ติ๊ก + แถบเวลา */}
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
      `}</style>
    </div>
  );
}
