// components/CouponPaymentPanel.js
"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";

export default function CouponPaymentPanel({
  showPay = false,
  couponValue = "",
  onCouponChange = () => {},
  onRedeem = () => {},
  onSkipNoCoupon = () => {},
  loading = false,
  codeLength = 8,
  qrUrl = "",
  payStatus = "",
  timeLeft = 0,
  expireSeconds = 120,
  formatTime = (s) => s,
  logoSrc = "/image/Thai_QR_Payment_Logo-01.jpg",
}) {
  const inputRef = useRef(null);

  // โฟกัสเฉพาะตอนสลับเข้าหน้า Coupon Mode
  useEffect(() => {
    if (!showPay && inputRef.current) {
      requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
      });
    }
  }, [showPay]);

  // ===== Pay Mode =====
  if (showPay) {
    const pct =
      expireSeconds > 0
        ? Math.max(0, Math.min(100, (timeLeft / expireSeconds) * 100))
        : 0;
    const isExpired = timeLeft <= 0;

    return (
      <div className="flex flex-col items-center justify-center flex-1 w-full ">
        {qrUrl && (
          <div className="mt-2 p-4 rounded-2xl border bg-white/90 dark:bg-gray-900/70 backdrop-blur shadow-md w-[360px] max-w-[92vw]">
            <div className="w-full mb-3">
              <div className="mx-auto w-[240px]">
                <Image
                  src={logoSrc}
                  alt="Thai QR Payment"
                  width={240}
                  height={99}
                  className="block mx-auto select-none shadow-xl shadow-blue-500/50"
                  priority
                />
              </div>
            </div>
            <img
              src={qrUrl}
              alt="PromptPay QR"
              className="w-60 h-60 mx-auto rounded-md border bg-white backdrop-blur-sm"
            />

            <p className="text-xs font-medium mt-3 mb-3 text-center">
              หากชำระเงินเสร็จสิ้น{" "}
              <span className="text-red-600 font-semibold">
                ระบบจะดำเนินการโดยอัตโนมัติ
              </span>
            </p>

            <div className="mt-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="opacity-70">
                  {isExpired ? "หมดเวลา" : "หมดเวลาใน"}
                </span>
                <span className="font-semibold">{formatTime(timeLeft)}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                <div
                  className={`h-2 ${
                    isExpired
                      ? "bg-red-500"
                      : "bg-gradient-to-r from-rose-400 via-amber-400 to-emerald-400"
                  }`}
                  style={{ width: `${pct}%`, transition: "width 1s linear" }}
                />
              </div>
            </div>

            <div className="text-xs text-center mt-2 opacity-70">
              Status: {payStatus || "—"}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===== Coupon Mode =====
  return (
    <div className="flex flex-col items-center justify-between w-full">
      {/* Panel coupon */}
      <div className="w-full max-w-[360px] rounded-2xl border bg-blue/10 dark:bg-white/5 backdrop-blur p-3 shadow-sm ring ring-pink-500 ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-900 shadow-2xl">
        <label htmlFor="coupon-input" className="block text-xs mb-1.5 opacity-80">
          Coupon
        </label>

        <input
          id="coupon-input"
          ref={inputRef}
          className="w-full h-10 rounded-lg border bg-blue-100 dark:bg-white/5 px-3 text-sm outline-none tracking-widest text-center"
          placeholder="_ _ _ _ _ _ _ _"
          value={couponValue}
          onChange={(e) => onCouponChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && couponValue.length === codeLength) onRedeem();
          }}
          maxLength={codeLength}
          inputMode="latin"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Coupon code"
        />

        <div className="flex gap-2 mt-2">
          <button
            onClick={onRedeem}
            disabled={loading || couponValue.length !== codeLength}
            className={`flex-1 h-9 rounded-lg text-sm font-medium transition
              ${
                loading || couponValue.length !== codeLength
                  ? "bg-gray-300/50 dark:bg-gray-700/50 text-gray-500 cursor-not-allowed"
                  : "bg-white/85 dark:bg-gray-800/85 border hover:bg-white dark:hover:bg-gray-800"
              }`}
            title="Redeem Now"
          >
            Redeem Now
          </button>
        </div>
      </div>

      {/* ปุ่ม 'ไม่มีคูปอง' */}
      <div className="mt-4">
        <button
          onClick={onSkipNoCoupon}
          disabled={loading}
          className={`w-full max-w-[320px] py-2 px-4 rounded-md border text-sm font-medium transition
            ${
              loading
                ? "bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed"
                : "border-dashed border-gray-400 hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-cyan-500 shadow-lg shadow-cyan-500/50"
            }`}
          title="ไม่มีคูปอง กดข้ามไปชำระเงิน"
        >
          ไม่มีคูปอง — ข้ามไปยังส่วนการชำระเงิน
        </button>
      </div>

      {/* ลูกศรชี้ลง */}
      <div className="w-full max-w-[680px] mt-8 mb-2">
        <div className="relative h-[160px] sm:h-[200px] flex items-start justify-center select-none">
          <svg
            viewBox="0 0 300 180"
            className="relative w-[72%] max-w-[520px] h-full"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="chevGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
            </defs>

            <g fill="url(#chevGrad)" opacity="0.95">
              <path className="chev chev1" d="M150 160 L190 120 L170 120 L150 140 L130 120 L110 120 Z" />
              <path className="chev chev2" d="M150 110 L195 70 L172 70 L150 92 L128 70 L105 70 Z" />
              <path className="chev chev3" d="M150 60 L200 20 L173 20 L150 45 L127 20 L100 20 Z" />
            </g>
          </svg>
        </div>
      </div>

      <style jsx>{`
        .chev {
          transform-origin: 150px 180px;
          animation: drop 1.4s ease-in-out infinite;
        }
        .chev1 { animation-delay: 0ms; }
        .chev2 { animation-delay: 180ms; }
        .chev3 { animation-delay: 360ms; }
        @keyframes drop {
          0%, 100% { transform: translateY(0); opacity: .9; }
          50%      { transform: translateY(8px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
